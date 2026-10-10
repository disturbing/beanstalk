/**
 * The registry RPC (`RepositoriesRpc`): create provisions the Artifacts repo (empty with a
 * README, a template, or an import), puts its first commit on the stalk and the sprout, opens
 * the engine and only then lists the repository. A failure on the way removes what was made,
 * so the name is free again.
 */
import type { IdentityEnv } from '@gitstalk/shared-identity/identity-env';
import { recordOrgAudit } from '@gitstalk/shared-identity/org-audit';
import type { RepositoryOwnerRef } from '@gitstalk/shared-identity/orgs';
import {
  findOrgByHandle,
  mayCreateRepository,
  mayInOrg,
  orgRole,
  orgsOf,
  ownerByHandle,
  ownerOf,
} from '@gitstalk/shared-identity/orgs';
import { findUserById } from '@gitstalk/shared-identity/users';
import type { RpcError, RpcResult } from '@gitstalk/shared-race/rpc';
import type {
  RepoOrigin,
  RepoOwner,
  RepositoriesRpc,
  RepositoryRecord,
} from '@gitstalk/shared-race/repos';
import {
  CreateRepositoryInput,
  RepoOwner as RepoOwnerSchema,
  UpdateRepositoryInput,
} from '@gitstalk/shared-race/repos';

import { artifactsCode } from '../adapters/artifacts';
import type { RepositoryStorage } from '../adapters/repository-storage';
import { orgRepositoryRole } from '../auth/git-credential';
import { GatewayError } from '../errors';
import type { Logger } from '../log';
import { accessResult, archivedError, decideAccess, viewerPrincipal } from './access';
import type { CollaboratorStore } from './collaborators';
import type { RepoEnginePort } from './engine-port';
import type { Registry } from './registry';
import type { RepositoryCleanup } from './repository-cleanup';
import { emptyStart, templateFiles } from './templates';

export type RepositoriesDeps = {
  readonly registry: Registry;
  readonly collaborators: CollaboratorStore;
  /** People and orgs (IDENTITY_DB): whose namespace a handle is, and org roles. */
  readonly identity: IdentityEnv;
  readonly storage: RepositoryStorage;
  readonly engine: RepoEnginePort;
  /** What a deleted repository leaves outside the registry; never throws. */
  readonly cleanup: RepositoryCleanup;
  readonly log: Logger;
  readonly now: () => number;
  readonly newId: () => string;
};

/** Artifacts' answers that mean the URL is not a public git repository. */
const IMPORT_REFUSALS: ReadonlySet<string> = new Set([
  'REMOTE_AUTH_REQUIRED',
  'NOT_FOUND',
  'INVALID_URL',
]);
/** Why a person's repository cannot be internal. */
const INTERNAL_NEEDS_ORG =
  "only an organization's repository can be internal (readable by its members); choose public or private";
const SEED_AUTHOR = { name: 'Beanstalk', email: 'seed@beanstalk.invalid' };
const ID_LENGTH = 12;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function repositoriesRpc(deps: RepositoriesDeps): RepositoriesRpc {
  return {
    createRepository: (owner, input) => guarded(() => create(deps, owner, input)),
    listRepositories: (ownerId, viewer, listing) =>
      guarded(async () => {
        const records = await deps.registry.byOwner(
          ownerId,
          listing === 'archived' ? 'archived' : 'active',
        );
        const principal = viewerPrincipal(viewer);
        const readable = await Promise.all(
          records.map(async (record) => {
            const decision = await decideAccess(deps.collaborators, record, {
              principal,
              action: 'read',
            });
            return decision.verdict === 'allowed' ? record : null;
          }),
        );
        return ok(readable.filter((record) => record !== null));
      }),
    getRepository: (ownerHandle, name, viewer) =>
      guarded(async () =>
        accessResult(deps.collaborators, await deps.registry.resolve(ownerHandle, name), {
          principal: viewerPrincipal(viewer),
          action: 'read',
          what: `${ownerHandle}/${name}`,
        }),
      ),
    updateRepository: (actorId, repoId, patch) =>
      guarded(async () => {
        const parsed = UpdateRepositoryInput.safeParse(patch);
        if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid change');
        const socialKey = parsed.data.social_image_key;
        // A repository's social image is its own upload, never another repository's object.
        if (typeof socialKey === 'string' && !socialKey.startsWith(`repos/${repoId}/social/`))
          return invalid('that social image belongs to another repository');
        const owned = await administered(deps, actorId, repoId);
        if (!owned.ok) return owned;
        if (owned.value.archived_at !== null)
          return { ok: false, error: archivedError(owned.value, 'administer') };
        if (parsed.data.visibility === 'internal' && owned.value.owner_kind !== 'org')
          return invalid(INTERNAL_NEEDS_ORG);
        const updated = await deps.registry.update(repoId, parsed.data, deps.now());
        if (updated === null) return missing(repoId);
        if (updated === 'taken') return taken(owned.value.owner.handle, parsed.data.name ?? '');
        if (updated.visibility !== owned.value.visibility)
          await deps.collaborators
            .auditStatement({
              repoId,
              actor: owned.value.owner,
              action: 'repository.visibility',
              detail: `${owned.value.visibility} → ${updated.visibility}`,
            })
            .run();
        return ok(updated);
      }),
    deleteRepository: (actorId, repoId) =>
      guarded(async () => {
        const owned = await administered(deps, actorId, repoId);
        if (!owned.ok) return owned;
        await deps.registry.remove(repoId);
        // The engine stops before its repo goes, so nothing it does meets a missing repo.
        await deps.engine.close(owned.value.engine_id);
        await deps.storage.delete(owned.value.artifacts_repo);
        await deps.cleanup(owned.value);
        deps.log.info('repository deleted', { repo: repoId });
        return ok({ deleted: true as const });
      }),
    archiveRepository: (actorId, repoId, to) =>
      guarded(async () => {
        if (to !== 'archived' && to !== 'active')
          return invalid('archive to "archived" or "active"');
        const owned = await administered(deps, actorId, repoId);
        if (!owned.ok) return owned;
        const changed = await deps.registry.setListing(repoId, to, deps.now());
        if (changed === null) return missing(repoId);
        deps.log.info(to === 'archived' ? 'repository archived' : 'repository unarchived', {
          repo: repoId,
        });
        return ok(changed);
      }),
    transferRepository: (actorId, repoId, toHandle) =>
      guarded(() => transfer(deps, { actorId, repoId, toHandle })),
    repositoryActivity: (ownerId, limit) =>
      guarded(async () => {
        // Org repositories the person reads through their org role join their activity.
        const orgs = await orgsOf(deps.identity, ownerId);
        const readable = orgs.filter(
          ({ org, role }) =>
            orgRepositoryRole({ role, basePermission: org.basePermission }) !== null,
        );
        const orgIds = readable.map(({ org }) => org.id);
        // Every member reads the org's internal repositories, whatever the base permission.
        const memberOrgIds = orgs.map(({ org }) => org.id);
        return ok(await deps.registry.activity(ownerId, limit, orgIds, memberOrgIds));
      }),
    repositoryFiles: (repoId, viewer) =>
      guarded(async () => {
        const record = await accessResult(deps.collaborators, await deps.registry.byId(repoId), {
          principal: viewerPrincipal(viewer),
          action: 'read',
          what: repoId,
        });
        if (!record.ok) return record;
        const { artifacts_repo: artifactsRepo, default_branch: branch } = record.value;
        return ok(await deps.storage.files(artifactsRepo, branch));
      }),
  };
}

/** A fresh repository id: 12 of [a-z0-9], which is also a valid run id for the engine. */
export function newRepositoryId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH));
  return Array.from(bytes, (byte) => ID_ALPHABET[byte % ID_ALPHABET.length]).join('');
}

/** The Artifacts repo of a repository: named by id, so a rename never moves storage. */
export function artifactsRepoName(id: string): string {
  return `repo-${id}`;
}

async function create(
  deps: RepositoriesDeps,
  rawOwner: RepoOwner,
  rawInput: CreateRepositoryInput,
): Promise<RpcResult<RepositoryRecord>> {
  const owner = RepoOwnerSchema.safeParse(rawOwner);
  if (!owner.success) return invalid('the owner is not a valid user');
  const parsed = CreateRepositoryInput.safeParse(rawInput);
  if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid repository');
  const input = parsed.data;
  const namespace = await namespaceFor(deps, owner.data, input.owner);
  if (!namespace.ok) return namespace;
  if (input.visibility === 'internal' && namespace.value.kind !== 'org')
    return invalid(INTERNAL_NEEDS_ORG);
  const id = deps.newId();
  const artifactsRepo = artifactsRepoName(id);
  const origin: RepoOrigin = input.start;
  const reserved = await deps.registry.reserve(
    {
      id,
      owner: { id: namespace.value.id, handle: namespace.value.handle },
      ownerKind: namespace.value.kind,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      origin,
      artifactsRepo,
      engineId: id,
    },
    deps.now(),
  );
  if (!reserved) return taken(namespace.value.handle, input.name);
  try {
    await provision(deps, {
      artifactsRepo,
      name: input.name,
      description: input.description,
      origin,
    });
    const { engineId } = await deps.engine.open({
      repoName: input.name,
      artifactsRepo,
      owner: { id: namespace.value.id, handle: namespace.value.handle },
    });
    const record = await deps.registry.markReady(id, engineId, deps.now());
    if (record === null) throw new GatewayError(`repository ${id} vanished`, 'conflict', 409);
    deps.log.info('repository created', {
      repo: id,
      origin: origin.kind,
      engine: engineId,
      owner: namespace.value.kind,
    });
    if (namespace.value.kind === 'org')
      await recordOrgAudit(
        deps.identity,
        {
          orgId: namespace.value.id,
          actor: owner.data,
          action: 'repository.create',
          detail: record.name,
        },
        deps.now(),
      );
    return ok(record);
  } catch (error: unknown) {
    await undo(deps, id, artifactsRepo);
    throw error;
  }
}

/**
 * Whose namespace a new repository goes in: the creator's own (no handle, or theirs), or an
 * org whose repository setting lets the creator's role create there. Outsiders get 404.
 */
async function namespaceFor(
  deps: RepositoriesDeps,
  creator: RepoOwner,
  handle: string | undefined,
): Promise<RpcResult<RepositoryOwnerRef>> {
  if (
    handle === undefined ||
    handle === '' ||
    handle.toLowerCase() === creator.handle.toLowerCase()
  )
    return ok({ kind: 'user', id: creator.id, handle: creator.handle });
  const org = await findOrgByHandle(deps.identity, handle);
  const role = org === null ? null : await orgRole(deps.identity, org.id, creator.id);
  if (org === null || role === null)
    return failure({ code: 'not_found', status: 404, message: `no organization named ${handle}` });
  if (!mayCreateRepository(role, org.repoCreation))
    return failure({
      code: 'forbidden',
      status: 403,
      message: `in ${org.handle} only owners and admins create repositories; you are a ${role}`,
    });
  return ok({ kind: 'org', id: org.id, handle: org.handle });
}

/**
 * Moves a repository the actor administers to their own namespace or to an org where they
 * are an owner or admin; audited on the repository and on each org involved.
 */
async function transfer(
  deps: RepositoriesDeps,
  input: { readonly actorId: string; readonly repoId: string; readonly toHandle: string },
): Promise<RpcResult<RepositoryRecord>> {
  const owned = await administered(deps, input.actorId, input.repoId);
  if (!owned.ok) return owned;
  const [target, actor] = await Promise.all([
    ownerByHandle(deps.identity, input.toHandle),
    findUserById(deps.identity, input.actorId),
  ]);
  if (target === null || actor === null)
    return failure({
      code: 'not_found',
      status: 404,
      message: `nobody is called ${input.toHandle}`,
    });
  const from = ownerOf(owned.value);
  if (target.id === from.id) return invalid(`${target.handle} already owns it`);
  const mayReceive =
    target.kind === 'user'
      ? target.id === actor.id
      : mayInOrg(await orgRole(deps.identity, target.id, actor.id), 'transfer-in');
  if (!mayReceive)
    return failure({
      code: 'forbidden',
      status: 403,
      message:
        'move a repository to yourself or to an organization where you are an owner or admin',
    });
  const moved = await deps.registry.transfer(input.repoId, target, deps.now());
  if (moved === null) return missing(input.repoId);
  if (moved === 'taken') return taken(target.handle, owned.value.name);
  await auditTransfer(deps, { actor, from, to: target, name: moved.name, repoId: moved.id });
  deps.log.info('repository transferred', { repo: moved.id, to: target.kind });
  return ok(moved);
}

async function auditTransfer(
  deps: RepositoriesDeps,
  move: {
    readonly actor: { readonly id: string; readonly handle: string };
    readonly from: RepositoryOwnerRef;
    readonly to: RepositoryOwnerRef;
    readonly name: string;
    readonly repoId: string;
  },
): Promise<void> {
  const actor = { id: move.actor.id, handle: move.actor.handle };
  const now = deps.now();
  const writes: Promise<unknown>[] = [
    deps.collaborators
      .auditStatement({
        repoId: move.repoId,
        actor,
        action: 'repository.transfer',
        detail: `${move.from.handle} → ${move.to.handle}`,
      })
      .run(),
  ];
  if (move.to.kind === 'org')
    writes.push(
      recordOrgAudit(
        deps.identity,
        {
          orgId: move.to.id,
          actor,
          action: 'repository.transfer_in',
          detail: `${move.from.handle}/${move.name}`,
        },
        now,
      ),
    );
  if (move.from.kind === 'org')
    writes.push(
      recordOrgAudit(
        deps.identity,
        {
          orgId: move.from.id,
          actor,
          action: 'repository.transfer_out',
          detail: `→ ${move.to.handle}/${move.name}`,
        },
        now,
      ),
    );
  await Promise.all(writes);
}

async function provision(
  deps: RepositoriesDeps,
  repo: {
    readonly artifactsRepo: string;
    readonly name: string;
    readonly description: string;
    readonly origin: RepoOrigin;
  },
): Promise<void> {
  const { storage } = deps;
  const description = repo.description === '' ? repo.name : repo.description;
  if (repo.origin.kind === 'import') {
    const { url } = repo.origin;
    await storage.importFrom(repo.artifactsRepo, url, description).catch((error: unknown) => {
      if (IMPORT_REFUSALS.has(artifactsCode(error) ?? ''))
        throw new GatewayError(
          `${url} is not a public git repository (it asked for credentials or was not found)`,
          'import_refused',
          422,
          { cause: error },
        );
      throw error;
    });
    const head = await storage.lineFromDefault(repo.artifactsRepo);
    if (head === null)
      throw new GatewayError('the imported repository is empty', 'invalid_request', 422);
    return;
  }
  await storage.create(repo.artifactsRepo, description);
  const files =
    repo.origin.kind === 'template'
      ? templateFiles(repo.origin.template, repo.name, repo.description)
      : emptyStart(repo.name, repo.description);
  const message =
    repo.origin.kind === 'template' ? 'Start from the TypeScript starter' : 'Initial commit';
  await storage.seed(repo.artifactsRepo, {
    files,
    message,
    author: SEED_AUTHOR,
    time: Math.floor(deps.now() / 1000),
  });
}

/** Removes a half-made repository; failures here are logged, the original error stands. */
async function undo(deps: RepositoriesDeps, id: string, artifactsRepo: string): Promise<void> {
  const results = await Promise.allSettled([
    deps.registry.remove(id),
    deps.storage.delete(artifactsRepo),
  ]);
  const failed = results.filter((result) => result.status === 'rejected').length;
  if (failed > 0) deps.log.warn('repository cleanup incomplete', { repo: id, failed });
}

/** The repository, when the actor may administer it (its owner); 404 or 403 otherwise. */
async function administered(
  deps: RepositoriesDeps,
  actorId: string,
  repoId: string,
): Promise<RpcResult<RepositoryRecord>> {
  return accessResult(deps.collaborators, await deps.registry.byId(repoId), {
    principal: viewerPrincipal(actorId),
    action: 'administer',
    what: repoId,
  });
}

/** Runs a call; gateway errors (Artifacts failures included) become error values. */
async function guarded<T>(use: () => Promise<RpcResult<T>>): Promise<RpcResult<T>> {
  try {
    return await use();
  } catch (error: unknown) {
    if (error instanceof GatewayError)
      return failure({ code: error.code, status: error.status, message: error.message });
    throw error;
  }
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

function failure(error: RpcError): { ok: false; error: RpcError } {
  return { ok: false, error };
}

function invalid(message: string): { ok: false; error: RpcError } {
  return failure({ code: 'invalid_request', status: 400, message });
}

function missing(what: string): { ok: false; error: RpcError } {
  return failure({ code: 'not_found', status: 404, message: `repository ${what} not found` });
}

function taken(handle: string, name: string): { ok: false; error: RpcError } {
  return failure({
    code: 'name_taken',
    status: 409,
    message: `${handle} already has a repository named ${name}`,
  });
}
