/**
 * Persistent repositories (`docs/claude-opus/20-repositories.md`): the registry's records and
 * the gateway RPC that creates, lists, reads, updates and deletes them. A repository is owned
 * by one user, holds one Artifacts repo (provisioned by the gateway; nobody else holds its
 * tokens) and one continuous engine instance, whose state the run read RPCs serve by
 * `engine_id`.
 */
import { z } from 'zod';

import type { RpcResult } from './rpc';

/** Characters of a repository name; GitHub's limit. */
export const MAX_REPO_NAME = 100;
/** Characters of a description. */
export const MAX_REPO_DESCRIPTION = 350;

/**
 * A repository name as it appears in `/<owner>/<repo>` and the clone URL: letters, digits,
 * `.`, `-` and `_`, not `.` or `..`, and not ending in `.git` (the URL adds it).
 */
export const RepoName = z
  .string()
  .trim()
  .min(1, 'Give the repository a name.')
  .max(MAX_REPO_NAME, `Keep the name under ${MAX_REPO_NAME + 1} characters.`)
  .regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, ".", "-" and "_" only.')
  .refine((name) => name !== '.' && name !== '..', 'Pick a name other than "." or "..".')
  .refine((name) => !name.toLowerCase().endsWith('.git'), 'Leave ".git" off; the URL adds it.');

export const RepoVisibility = z.enum(['public', 'private']);
export type RepoVisibility = z.infer<typeof RepoVisibility>;

/** The starters a repository can begin from. */
export const RepoTemplate = z.enum(['typescript-starter']);
export type RepoTemplate = z.infer<typeof RepoTemplate>;

/** A public HTTPS git URL to import (Artifacts imports over HTTPS only, without credentials). */
export const ImportUrl = z
  .string()
  .trim()
  .max(500)
  .url('Paste an https:// git URL.')
  .refine((url) => url.startsWith('https://'), 'Imports need an https:// URL.')
  .refine((url) => !/^https:\/\/[^/]*@/.test(url), 'Remove the credentials from the URL.');

/** How a new repository starts: a README only, a template, or an import. */
export const RepoStart = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('template'), template: RepoTemplate }),
  z.object({ kind: z.literal('import'), url: ImportUrl }),
]);
export type RepoStart = z.infer<typeof RepoStart>;

export const CreateRepositoryInput = z.object({
  name: RepoName,
  description: z.string().trim().max(MAX_REPO_DESCRIPTION).default(''),
  visibility: RepoVisibility,
  start: RepoStart,
});
export type CreateRepositoryInput = z.input<typeof CreateRepositoryInput>;

export const UpdateRepositoryInput = z
  .object({
    name: RepoName.optional(),
    description: z.string().trim().max(MAX_REPO_DESCRIPTION).optional(),
    visibility: RepoVisibility.optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), 'Change something.');
export type UpdateRepositoryInput = z.input<typeof UpdateRepositoryInput>;

/** The user a repository belongs to, as accounts name them (`requireUser`). */
export const RepoOwner = z.object({
  id: z.string().min(1).max(64),
  handle: z
    .string()
    .min(1)
    .max(39)
    .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/),
});
export type RepoOwner = z.infer<typeof RepoOwner>;

/** How a repository began, as recorded. */
export type RepoOrigin =
  | { readonly kind: 'empty' }
  | { readonly kind: 'template'; readonly template: RepoTemplate }
  | { readonly kind: 'import'; readonly url: string };

export type RepositoryRecord = {
  /** Stable id; also names the Artifacts repo, so a rename never moves storage. */
  readonly id: string;
  readonly owner: RepoOwner;
  readonly name: string;
  readonly description: string;
  readonly visibility: RepoVisibility;
  readonly origin: RepoOrigin;
  /** The Artifacts repo in the gateway's namespace. */
  readonly artifacts_repo: string;
  /** The engine instance; the run read RPCs (`runView`, `runEvents`, `repoTree` …) take it. */
  readonly engine_id: string;
  /** The stable line: `stalk`. */
  readonly default_branch: string;
  /** ISO 8601. */
  readonly created_at: string;
  readonly updated_at: string;
};

/** One line of a repository's own history (created, renamed …), newest first in listings. */
export type RepositoryActivity = {
  readonly repo_id: string;
  readonly owner_handle: string;
  readonly repo_name: string;
  /** ISO 8601. */
  readonly at: string;
  readonly kind: 'created' | 'renamed' | 'described' | 'visibility';
  /** A sentence for a person: "Created from the TypeScript starter." */
  readonly text: string;
};

/** The stalk's files, for the empty-repository page (read from Artifacts by the gateway). */
export type RepositoryFiles = {
  readonly ref: string;
  /** The stalk's commit, or null before anything is on it. */
  readonly sha: string | null;
  readonly files: readonly string[];
  /** README.md at the root, cut at 8,000 characters, or null. */
  readonly readme: string | null;
  /** `.beanstalk/checks.toml`, or null. */
  readonly checks: string | null;
  readonly truncated: boolean;
};

/** Who is asking: a signed-in user's id, or null for an anonymous reader. */
export type Viewer = string | null;

/**
 * The registry RPC on the gateway's default entrypoint. The web app authenticates the user
 * (`requireUser`) before calling; the gateway trusts the binding for identity and checks
 * ownership and visibility itself.
 */
export type RepositoriesRpc = {
  createRepository(
    owner: RepoOwner,
    input: CreateRepositoryInput,
  ): Promise<RpcResult<RepositoryRecord>>;
  /** An owner's repositories, newest first; private ones only when the viewer is the owner. */
  listRepositories(ownerId: string, viewer: Viewer): Promise<RpcResult<readonly RepositoryRecord[]>>;
  getRepository(
    ownerHandle: string,
    name: string,
    viewer: Viewer,
  ): Promise<RpcResult<RepositoryRecord>>;
  updateRepository(
    ownerId: string,
    repoId: string,
    patch: UpdateRepositoryInput,
  ): Promise<RpcResult<RepositoryRecord>>;
  deleteRepository(ownerId: string, repoId: string): Promise<RpcResult<{ readonly deleted: true }>>;
  /** The owner's repositories' own history, newest first. */
  repositoryActivity(
    ownerId: string,
    limit: number,
  ): Promise<RpcResult<readonly RepositoryActivity[]>>;
  repositoryFiles(repoId: string, viewer: Viewer): Promise<RpcResult<RepositoryFiles>>;
};
