import { BeanUpdateResult } from '@gitstalk/shared-race/collaboration';
import type {
  BeanChanges,
  BeanPromise,
  BeanRecord,
  BeanReliance,
  BeanUpdateInput,
  CollaborationSource,
  ContributorTokenClaims,
  PromiseReference,
} from '@gitstalk/shared-race/collaboration';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import type { CollaborationStorage } from './store';
import {
  appendEvent,
  currentPromiseRevision,
  failure,
  idempotent,
  nextEventId,
  notifyBeans,
  readBean,
  readPromise,
  saveBean,
  savePromise,
  saveReliance,
} from './store';

type Update = {
  bean: BeanRecord;
  event: number;
  claims: ContributorTokenClaims;
  input: BeanUpdateInput;
  now: string;
};

/** Revise only the contributor's bean; duplicate retries return the original result. */
export function updateBean(
  storage: CollaborationStorage,
  claims: ContributorTokenClaims,
  input: BeanUpdateInput,
): RpcResult<BeanUpdateResult> {
  if (input.bean !== claims.bean)
    return failure('forbidden', 403, 'contributors may update only their own bean');
  return idempotent(
    storage,
    {
      bean: claims.bean,
      actor: claims.actor,
      key: input.idempotency_key,
      payload: { method: 'bean_update', input },
      schema: BeanUpdateResult,
    },
    () => commitUpdate(storage.sql, claims, input),
  );
}

/** References are exact, current offers; stale assumptions are never silently advanced. */
export function validateReferences(
  sql: SqlStorage,
  references: readonly PromiseReference[],
): RpcResult<{ valid: true }> {
  for (const reference of references) {
    if (readPromise(sql, reference) === null)
      return failure('not_found', 404, 'referenced promise revision does not exist');
    if (currentPromiseRevision(sql, reference.bean, reference.promise) !== reference.revision) {
      return failure('conflict', 409, 'referenced promise revision is no longer current');
    }
  }
  return { ok: true, value: { valid: true } };
}

function commitUpdate(
  sql: SqlStorage,
  claims: ContributorTokenClaims,
  input: BeanUpdateInput,
): RpcResult<BeanUpdateResult> {
  const bean = readBean(sql, claims.bean);
  if (bean === null) return failure('not_found', 404, 'bean does not exist');
  if (bean.revision !== input.expected_revision)
    return failure('conflict', 409, 'bean revision changed; fetch current context');
  const references = validateReferences(sql, input.changes.reliance ?? []);
  if (!references.ok) return references;
  const capacity = validateCapacity(sql, claims.bean, input.changes);
  if (!capacity.ok) return capacity;
  const now = new Date().toISOString();
  const updated: BeanRecord = {
    ...bean,
    revision: bean.revision + 1,
    actor: claims.actor,
    updated_at: now,
    intent: input.changes.intent ?? bean.intent,
    approach: input.changes.approach ?? bean.approach,
  };
  const update: Update = { bean: updated, event: nextEventId(sql), claims, input, now };
  persistUpdate(sql, update);
  return { ok: true, value: { bean: updated, event_id: update.event } };
}

function persistUpdate(sql: SqlStorage, update: Update): void {
  saveBean(sql, update.bean);
  const source = { bean: update.bean.bean, revision: update.bean.revision, event_id: update.event };
  const offers = writePromises(sql, update, source);
  writeReliance(sql, update, source);
  appendEvent(sql, {
    kind: 'bean.updated',
    event_id: update.event,
    bean: update.bean.bean,
    author_bean: update.bean.bean,
    actor: update.claims.actor,
    revision: update.bean.revision,
    created_at: update.now,
    changes: update.input.changes,
  });
  notifyConsumers(sql, update.event, offers, update.bean.bean);
}

function writePromises(
  sql: SqlStorage,
  update: Update,
  source: CollaborationSource,
): BeanPromise[] {
  const promises: BeanPromise[] = [];
  for (const offer of update.input.changes.promises ?? []) {
    const promise: BeanPromise = {
      ...offer,
      bean: update.bean.bean,
      revision: (currentPromiseRevision(sql, update.bean.bean, offer.id) ?? 0) + 1,
      actor: update.claims.actor,
      offered_at: update.now,
      source,
    };
    savePromise(sql, promise);
    promises.push(promise);
  }
  return promises;
}

function writeReliance(sql: SqlStorage, update: Update, source: CollaborationSource): void {
  for (const reference of update.input.changes.remove_reliance ?? []) {
    sql.exec(
      'DELETE FROM collaboration_reliance WHERE owner = ? AND bean = ? AND promise = ?',
      update.bean.bean,
      reference.bean,
      reference.promise,
    );
  }
  for (const reference of update.input.changes.reliance ?? []) {
    const reliance: BeanReliance = {
      ...reference,
      actor: update.claims.actor,
      recorded_at: update.now,
      accepted_event: null,
      source,
    };
    saveReliance(sql, update.bean.bean, reliance);
  }
}

function validateCapacity(
  sql: SqlStorage,
  bean: string,
  changes: BeanChanges,
): RpcResult<{ valid: true }> {
  const offers = changes.promises ?? [];
  if (new Set(offers.map((offer) => offer.id)).size !== offers.length)
    return failure('invalid_request', 400, 'duplicate promise IDs in one update');
  const promises = sql
    .exec<{ promise: string }>(
      'SELECT promise FROM collaboration_promise_heads WHERE bean = ?',
      bean,
    )
    .toArray();
  if (
    new Set([...promises.map((row) => row.promise), ...offers.map((offer) => offer.id)]).size > 64
  )
    return failure('invalid_state', 409, 'bean has reached its promise limit');
  return validateRelianceCapacity(sql, bean, changes);
}

function validateRelianceCapacity(
  sql: SqlStorage,
  bean: string,
  changes: BeanChanges,
): RpcResult<{ valid: true }> {
  const references = changes.reliance ?? [];
  const additions = new Set(references.map(referenceKey));
  const removals = new Set((changes.remove_reliance ?? []).map(referenceKey));
  if (
    additions.size !== references.length ||
    removals.size !== (changes.remove_reliance ?? []).length
  )
    return failure('invalid_request', 400, 'duplicate reliance references in one update');
  if ([...removals].some((key) => additions.has(key)))
    return failure('invalid_request', 400, 'cannot add and remove the same reliance');
  const existing = sql
    .exec<{ bean: string; promise: string }>(
      'SELECT bean, promise FROM collaboration_reliance WHERE owner = ?',
      bean,
    )
    .toArray();
  const remaining = existing.map(referenceKey).filter((key) => !removals.has(key));
  if (new Set([...remaining, ...additions]).size > 128)
    return failure('invalid_state', 409, 'bean has reached its reliance limit');
  return { ok: true, value: { valid: true } };
}

function referenceKey(reference: { bean: string; promise: string }): string {
  return `${reference.bean}/${reference.promise}`;
}

function notifyConsumers(
  sql: SqlStorage,
  event: number,
  offers: readonly BeanPromise[],
  author: string,
): void {
  const recipients = new Set<string>();
  for (const offer of offers) {
    for (const consumer of sql
      .exec<{ owner: string }>(
        'SELECT owner FROM collaboration_reliance WHERE bean = ? AND promise = ?',
        offer.bean,
        offer.id,
      )
      .toArray()) {
      if (consumer.owner !== author) recipients.add(consumer.owner);
    }
  }
  notifyBeans(sql, event, recipients);
}
