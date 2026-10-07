/**
 * The repository registry through the GATEWAY binding (`RepositoriesRpc`), with every answer
 * validated before the app trusts it. Expected failures (a taken name, a missing repository)
 * come back as values; a binding without the methods (an older gateway) reads as "no
 * repositories" rather than an error page.
 */
import { z } from 'zod';

import type { RpcResult } from '@beanstalk/shared-race/rpc';
import type {
  CreateRepositoryInput,
  RepoOwner,
  RepositoriesRpc,
  RepositoryListing,
  UpdateRepositoryInput,
  Viewer,
} from '@beanstalk/shared-race/repos';

export const RepositoryRecord = z.object({
  id: z.string(),
  owner: z.object({ id: z.string(), handle: z.string() }),
  name: z.string(),
  description: z.string(),
  visibility: z.enum(['public', 'private']),
  origin: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('empty') }),
    z.object({ kind: z.literal('template'), template: z.literal('typescript-starter') }),
    z.object({ kind: z.literal('import'), url: z.string() }),
  ]),
  artifacts_repo: z.string(),
  engine_id: z.string(),
  default_branch: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  /** Null unless archived (an older gateway sends nothing: never archived). */
  archived_at: z.string().nullable().default(null),
});
export type RepositoryRecord = z.infer<typeof RepositoryRecord>;

/** What a person is on a repository: a collaborator role, or its owner. */
export const ViewerRole = z.enum(['read', 'write', 'maintain', 'owner']);
export type ViewerRole = z.infer<typeof ViewerRole>;

/** A repository with the viewer's role on it (null: none, reading a public one). */
export const RepositoryForViewer = RepositoryRecord.extend({ viewer_role: ViewerRole.nullable() });
export type RepositoryForViewer = z.infer<typeof RepositoryForViewer>;

export const RepositoryActivity = z.object({
  repo_id: z.string(),
  owner_handle: z.string(),
  repo_name: z.string(),
  at: z.string(),
  /** The registry's kinds and the engines' (`ACTIVITY_KINDS`); shown as text, so any string. */
  kind: z.string(),
  text: z.string(),
  bean: z.string().nullable().default(null),
  sha: z.string().nullable().default(null),
});
export type RepositoryActivity = z.infer<typeof RepositoryActivity>;

export const RepositoryFiles = z.object({
  ref: z.string(),
  sha: z.string().nullable(),
  files: z.array(z.string()),
  readme: z.string().nullable(),
  checks: z.string().nullable(),
  truncated: z.boolean(),
});
export type RepositoryFiles = z.infer<typeof RepositoryFiles>;

/** A failure the page shows to a person. */
export type RegistryFailure = { readonly code: string; readonly message: string };
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RegistryFailure };

export type RegistryClient = {
  create(owner: RepoOwner, input: CreateRepositoryInput): Promise<Outcome<RepositoryRecord>>;
  list(
    ownerId: string,
    viewer: Viewer,
    listing?: RepositoryListing,
  ): Promise<Outcome<readonly RepositoryRecord[]>>;
  get(ownerHandle: string, name: string, viewer: Viewer): Promise<Outcome<RepositoryForViewer>>;
  update(
    ownerId: string,
    repoId: string,
    patch: UpdateRepositoryInput,
  ): Promise<Outcome<RepositoryRecord>>;
  remove(ownerId: string, repoId: string): Promise<Outcome<{ readonly deleted: true }>>;
  /** Archive (`archived`) or unarchive (`active`); unavailable on a gateway without archive. */
  archive(
    actorId: string,
    repoId: string,
    to: RepositoryListing,
  ): Promise<Outcome<RepositoryRecord>>;
  activity(ownerId: string, limit: number): Promise<Outcome<readonly RepositoryActivity[]>>;
  files(repoId: string, viewer: Viewer): Promise<Outcome<RepositoryFiles>>;
};

const METHODS = [
  'createRepository',
  'listRepositories',
  'getRepository',
  'updateRepository',
  'deleteRepository',
  'repositoryActivity',
  'repositoryFiles',
] as const satisfies readonly (keyof RepositoriesRpc)[];

const UNAVAILABLE: RegistryFailure = {
  code: 'unavailable',
  message: 'The repository registry is not reachable from this deployment.',
};

/** The registry behind a binding (the GATEWAY service binding on Workers, a fake in tests). */
export function registryClient(binding: object): RegistryClient {
  const rpc = isRepositoriesRpc(binding) ? binding : null;
  const call = async <S extends z.ZodType>(
    schema: S,
    use: (registry: RepositoriesRpc) => Promise<RpcResult<unknown>>,
  ): Promise<Outcome<z.infer<S>>> => {
    if (rpc === null) return { ok: false, error: UNAVAILABLE };
    const result = await use(rpc);
    if (!result.ok)
      return { ok: false, error: { code: result.error.code, message: result.error.message } };
    return { ok: true, value: schema.parse(result.value) };
  };
  return {
    create: (owner, input) => call(RepositoryRecord, (r) => r.createRepository(owner, input)),
    list: (ownerId, viewer, listing = 'active') =>
      call(z.array(RepositoryRecord), (r) =>
        // An older gateway ignores the listing and has no archived repositories.
        listing === 'archived' && !hasArchive(r)
          ? Promise.resolve({ ok: true, value: [] })
          : r.listRepositories(ownerId, viewer, listing),
      ),
    get: (ownerHandle, name, viewer) =>
      call(RepositoryForViewer, (r) => r.getRepository(ownerHandle, name, viewer)),
    update: (ownerId, repoId, patch) =>
      call(RepositoryRecord, (r) => r.updateRepository(ownerId, repoId, patch)),
    archive: (actorId, repoId, to) =>
      call(RepositoryRecord, (r) =>
        hasArchive(r)
          ? r.archiveRepository(actorId, repoId, to)
          : Promise.resolve({
              ok: false,
              error: { code: 'unavailable', status: 503, message: UNAVAILABLE.message },
            }),
      ),
    remove: (ownerId, repoId) =>
      call(z.object({ deleted: z.literal(true) }), (r) => r.deleteRepository(ownerId, repoId)),
    activity: (ownerId, limit) =>
      call(z.array(RepositoryActivity), (r) => r.repositoryActivity(ownerId, limit)),
    files: (repoId, viewer) => call(RepositoryFiles, (r) => r.repositoryFiles(repoId, viewer)),
  };
}

function isRepositoriesRpc(binding: object): binding is RepositoriesRpc {
  return METHODS.every((method) => typeof Reflect.get(binding, method) === 'function');
}

/** Whether the gateway knows archive (added after the first registry methods). */
function hasArchive(rpc: RepositoriesRpc): boolean {
  return typeof Reflect.get(rpc, 'archiveRepository') === 'function';
}
