/**
 * What the account settings do, without the framework: change a handle (accounts first, then
 * the registry, undone if the registry fails), replace or remove a picture (upload, save the
 * key, then delete the old objects), and delete an account (guarded, then the registry, the
 * agents, the pictures and last the user row). The server actions and route handlers wrap
 * these with the real bindings; the tests drive them with fakes.
 */
import type { AccountFacts, DeletionPlan } from '@beanstalk/shared-identity/account-deletion';
import { deletionPlan, isDeletionConfirmed } from '@beanstalk/shared-identity/account-deletion';
import type { HandleChange } from '@beanstalk/shared-identity/profiles';
import type { ImageKind, UploadRefusalCode, UploadResult } from '@beanstalk/shared-media/images';

import type { FormState } from './form-state';

export type { FormState } from './form-state';

type GatewayResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } };

/** Who is acting, as the session named them. */
export type Actor = {
  readonly id: string;
  readonly handle: string;
  readonly ip: string | null;
  readonly now: number;
};

export type HandlePorts = {
  changeHandle(input: {
    userId: string;
    handle: string;
    ip: string | null;
    now: number;
  }): Promise<HandleChange>;
  revertHandleChange(input: {
    userId: string;
    from: string;
    to: string;
    changedAt: number | null;
    ip: string | null;
    now: number;
  }): Promise<void>;
  /** When the handle last changed before this one (restored if the registry fails). */
  previousChangeAt(userId: string): Promise<number | null>;
  renameOwner(userId: string, handle: string): Promise<GatewayResult<unknown>>;
};

/** Changes the handle in accounts, then moves the repositories; undoes the first if the second fails. */
export async function changeHandleFlow(
  actor: Actor,
  requested: string,
  ports: HandlePorts,
): Promise<FormState & { readonly handle: string | null }> {
  const changedAt = await ports.previousChangeAt(actor.id);
  const changed = await ports.changeHandle({
    userId: actor.id,
    handle: requested,
    ip: actor.ip,
    now: actor.now,
  });
  if (!changed.ok) return { saved: null, error: changed.message, handle: null };
  const moved = await ports.renameOwner(actor.id, changed.to);
  if (moved.ok)
    return {
      saved: `You are @${changed.to} now. Links to @${changed.from} keep working.`,
      error: null,
      handle: changed.to,
    };
  await ports.revertHandleChange({
    userId: actor.id,
    from: changed.from,
    to: changed.to,
    changedAt,
    ip: actor.ip,
    now: actor.now,
  });
  return {
    saved: null,
    error: 'Your repositories could not be moved to the new handle, so nothing changed. Try again.',
    handle: null,
  };
}

export type PicturePorts = {
  upload(kind: ImageKind, ownerId: string, file: Blob): Promise<UploadResult>;
  /** Saves the key on the owner's record and answers the key it replaced. */
  save(key: string | null): Promise<{ readonly previous: string | null }>;
  /** Deletes everything in the owner's picture slot except `keep`. */
  prune(kind: ImageKind, ownerId: string, keep: string | null): Promise<number>;
};

/**
 * A new picture: validated and stored, saved on the owner, then the old one deleted. A file
 * field that is missing or empty is a refusal, not a removal (removing has its own button).
 */
/** A picture save: the shared state, a code a redirect can carry, and the new key. */
export type PictureOutcome = FormState & {
  readonly code: UploadRefusalCode | 'updated';
  readonly key: string | null;
};

export async function replacePictureFlow(
  target: { readonly kind: ImageKind; readonly ownerId: string },
  file: Blob | string | null,
  ports: PicturePorts,
): Promise<PictureOutcome> {
  if (!(file instanceof Blob) || file.size === 0)
    return { saved: null, error: 'Choose an image file.', code: 'empty', key: null };
  const uploaded = await ports.upload(target.kind, target.ownerId, file);
  if (!uploaded.ok)
    return { saved: null, error: uploaded.error.message, code: uploaded.error.code, key: null };
  await ports.save(uploaded.image.key);
  await ports.prune(target.kind, target.ownerId, uploaded.image.key);
  return { saved: 'Picture updated.', error: null, code: 'updated', key: uploaded.image.key };
}

export async function removePictureFlow(
  target: { readonly kind: ImageKind; readonly ownerId: string },
  ports: PicturePorts,
): Promise<FormState> {
  const { previous } = await ports.save(null);
  if (previous !== null) await ports.prune(target.kind, target.ownerId, null);
  return {
    saved: previous === null ? 'There was no picture to remove.' : 'Picture removed.',
    error: null,
  };
}

export type DeletionPorts = {
  /** The person's organisations and repositories, from accounts and the registry. */
  facts(actor: Actor): Promise<AccountFacts>;
  closeAccount(
    userId: string,
  ): Promise<GatewayResult<{ readonly deletedRepositories: readonly string[] }>>;
  /** Disconnects every agent (OAuth grants and their session tokens). */
  disconnectAgents(userId: string): Promise<void>;
  deleteMedia(kind: ImageKind, ownerId: string): Promise<number>;
  deleteUser(actor: Actor): Promise<boolean>;
};

export type DeletionOutcome =
  | { readonly kind: 'deleted' }
  | { readonly kind: 'refused'; readonly state: FormState };

/**
 * Deletes the account when the handle was typed and nothing blocks it. Order matters: the
 * registry first (a failure there leaves the account usable and says so), then agents and
 * pictures, and the user row last, so a half-done deletion can be retried from Settings.
 */
export async function deleteAccountFlow(
  actor: Actor,
  typed: string,
  ports: DeletionPorts,
): Promise<DeletionOutcome> {
  if (!isDeletionConfirmed(typed, actor.handle)) return refused(`Type ${actor.handle} to confirm.`);
  const plan = deletionPlan(await ports.facts(actor));
  if (plan.kind === 'blocked') return refused(blockedMessage(plan));
  const closed = await ports.closeAccount(actor.id);
  if (!closed.ok)
    return refused(
      `Your repositories could not be deleted (${closed.error.message}). Nothing else changed.`,
    );
  await ports.disconnectAgents(actor.id);
  await Promise.all([
    ports.deleteMedia('user', actor.id),
    ...closed.value.deletedRepositories.map((repoId) => ports.deleteMedia('repo', repoId)),
  ]);
  await ports.deleteUser(actor);
  return { kind: 'deleted' };
}

/** The sentence a blocked deletion shows, naming each organisation. */
export function blockedMessage(plan: Extract<DeletionPlan, { kind: 'blocked' }>): string {
  const names = plan.soleOwnerOf.map((handle) => `@${handle}`).join(', ');
  return `You are the only owner of ${names}. Add another owner or delete ${plan.soleOwnerOf.length === 1 ? 'it' : 'them'} first.`;
}

function refused(error: string): DeletionOutcome {
  return { kind: 'refused', state: { saved: null, error } };
}
