/**
 * The registry RPC (`RepositoriesRpc`): create provisions the Artifacts repo (empty with a
 * README, a template, or an import), puts its first commit on the stalk and the sprout, opens
 * the engine and only then lists the repository. A failure on the way removes what was made,
 * so the name is free again.
 */
import type { RpcError, RpcResult } from '@beanstalk/shared-race/rpc';
import type {
  RepoOrigin,
  RepoOwner,
  RepositoriesRpc,
  RepositoryRecord,
} from '@beanstalk/shared-race/repos';
import {
  CreateRepositoryInput,
  RepoOwner as RepoOwnerSchema,
  UpdateRepositoryInput,
} from '@beanstalk/shared-race/repos';

import { artifactsCode } from '../adapters/artifacts';
import type { RepositoryStorage } from '../adapters/repository-storage';
import { GatewayError } from '../errors';
import type { Logger } from '../log';
import type { RepoEnginePort } from './engine-port';
import type { Registry } from './registry';
import { emptyStart, templateFiles } from './templates';

export type RepositoriesDeps = {
  readonly registry: Registry;
  readonly storage: RepositoryStorage;
  readonly engine: RepoEnginePort;
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
const SEED_AUTHOR = { name: 'Beanstalk', email: 'seed@beanstalk.invalid' };
const ID_LENGTH = 12;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function repositoriesRpc(deps: RepositoriesDeps): RepositoriesRpc {
  return {
    createRepository: (owner, input) => guarded(() => create(deps, owner, input)),
    listRepositories: (ownerId, viewer) =>
      guarded(async () => {
        const records = await deps.registry.byOwner(ownerId);
        return ok(records.filter((record) => canRead(record, viewer)));
      }),
    getRepository: (ownerHandle, name, viewer) =>
      guarded(async () => {
        const record = await deps.registry.byName(ownerHandle, name);
        return record !== null && canRead(record, viewer)
          ? ok(record)
          : missing(`${ownerHandle}/${name}`);
      }),
    updateRepository: (ownerId, repoId, patch) =>
      guarded(async () => {
        const parsed = UpdateRepositoryInput.safeParse(patch);
        if (!parsed.success) return invalid(parsed.error.issues[0]?.message ?? 'invalid change');
        const owned = await ownedBy(deps, ownerId, repoId);
        if (!owned.ok) return owned;
        const updated = await deps.registry.update(repoId, parsed.data, deps.now());
        if (updated === null) return missing(repoId);
        if (updated === 'taken') return taken(owned.value.owner.handle, parsed.data.name ?? '');
        return ok(updated);
      }),
    deleteRepository: (ownerId, repoId) =>
      guarded(async () => {
        const owned = await ownedBy(deps, ownerId, repoId);
        if (!owned.ok) return owned;
        await deps.registry.remove(repoId);
        // The engine stops before its repo goes, so nothing it does meets a missing repo.
        await deps.engine.close(owned.value.engine_id);
        await deps.storage.delete(owned.value.artifacts_repo);
        deps.log.info('repository deleted', { repo: repoId });
        return ok({ deleted: true as const });
      }),
    repositoryActivity: (ownerId, limit) =>
      guarded(async () => ok(await deps.registry.activity(ownerId, limit))),
    repositoryFiles: (repoId, viewer) =>
      guarded(async () => {
        const record = await deps.registry.byId(repoId);
        if (record === null || !canRead(record, viewer)) return missing(repoId);
        return ok(await deps.storage.files(record.artifacts_repo, record.default_branch));
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
  const id = deps.newId();
  const artifactsRepo = artifactsRepoName(id);
  const origin: RepoOrigin = input.start;
  const reserved = await deps.registry.reserve(
    {
      id,
      owner: owner.data,
      name: input.name,
      description: input.description,
      visibility: input.visibility,
      origin,
      artifactsRepo,
      engineId: id,
    },
    deps.now(),
  );
  if (!reserved) return taken(owner.data.handle, input.name);
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
      owner: owner.data,
    });
    const record = await deps.registry.markReady(id, engineId, deps.now());
    if (record === null) throw new GatewayError(`repository ${id} vanished`, 'conflict', 409);
    deps.log.info('repository created', {
      repo: id,
      origin: origin.kind,
      engine: engineId,
    });
    return ok(record);
  } catch (error: unknown) {
    await undo(deps, id, artifactsRepo);
    throw error;
  }
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

async function ownedBy(
  deps: RepositoriesDeps,
  ownerId: string,
  repoId: string,
): Promise<RpcResult<RepositoryRecord>> {
  const record = await deps.registry.byId(repoId);
  if (record === null) return missing(repoId);
  if (record.owner.id !== ownerId)
    return failure({ code: 'forbidden', status: 403, message: 'only the owner can change this' });
  return ok(record);
}

function canRead(record: RepositoryRecord, viewer: string | null): boolean {
  return record.visibility === 'public' || record.owner.id === viewer;
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
