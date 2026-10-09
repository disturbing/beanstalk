/**
 * Organization secrets and variables for Actions, next to repository secrets
 * (`docs/claude-opus/25-actions-and-automations.md` §3.4), in GitHub's model:
 *
 * - **Org secrets** are encrypted at rest like repository secrets and carry a repository access
 *   policy (all repositories, private repositories, or selected ones) and the same "available
 *   to pre-land checks" toggle (D4, default off).
 * - **Variables** (`vars.*`) are plain configuration at repository and org level, readable by
 *   anyone with a role, and given to every job of the repository (GitHub's rule: variables are
 *   not named per job, unlike secrets).
 * - **Resolution:** a job sees the org entries its repository is allowed plus the repository's
 *   own; on a name clash the repository's entry wins. Environments are out of scope.
 *
 * Served by the gateway's `Actions` entrypoint next to `ActionsRpc`. Access: org owners and
 * admins manage org entries; org members read names (and variable values); repository
 * maintainers and the owner manage repository entries; anyone with a role on the repository
 * reads names and variable values. No method ever returns a secret value.
 */
import { z } from 'zod';

import { SecretName } from './actions';
import type { Viewer } from './repos';
import type { RpcResult } from './rpc';

/** A variable's name: GitHub's rules, as for secrets (letters, digits, `_`; no `GITHUB_`). */
export const VariableName = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]{0,99}$/)
  .refine((name) => !name.toUpperCase().startsWith('GITHUB_'), 'names may not start with GITHUB_')
  .transform((name) => name.toUpperCase())
  .brand<'VariableName'>();
export type VariableName = z.infer<typeof VariableName>;

/** GitHub's limit on one variable's value. */
export const MAX_VARIABLE_BYTES = 48 * 1024;
/** At most this many repositories in one entry's selected list. */
export const MAX_SELECTED_REPOSITORIES = 500;

/** Which of an org's repositories an org entry reaches. `private` matches private repositories. */
export const RepositoryAccessPolicy = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({ kind: z.literal('private') }),
  z.object({
    kind: z.literal('selected'),
    repoIds: z.array(z.string().min(1).max(100)).max(MAX_SELECTED_REPOSITORIES),
  }),
]);
export type RepositoryAccessPolicy = z.infer<typeof RepositoryAccessPolicy>;

/** Where an entry a repository sees comes from. */
export type EntrySource =
  | { readonly kind: 'repository' }
  | { readonly kind: 'organization'; readonly orgHandle: string };

/** An org secret as its settings list it: never its value. */
export type OrgSecretSummary = {
  readonly name: SecretName;
  readonly access: RepositoryAccessPolicy;
  /** D4: also given to pre-land checks of beans from agents, deploy tokens and non-maintainers. */
  readonly prelandAllowed: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string;
};

export type VariableSummary = {
  readonly name: VariableName;
  readonly value: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
};

export type OrgVariableSummary = VariableSummary & { readonly access: RepositoryAccessPolicy };

/** A repository the org owns, for the "selected repositories" picker. */
export type OrgRepository = {
  readonly id: string;
  readonly name: string;
  readonly visibility: 'public' | 'private';
};

export type OrgActionsAuditAction =
  | 'org-secret-set'
  | 'org-secret-deleted'
  | 'org-variable-set'
  | 'org-variable-deleted';

/** One change to the org's secrets or variables: names and policies, never values. */
export type OrgActionsAuditEntry = {
  readonly at: string;
  readonly actorHandle: string;
  readonly action: OrgActionsAuditAction;
  /** The name, and for a save the access policy (`DEPLOY_KEY · selected: 2 repositories`). */
  readonly detail: string;
};

/** Org Settings → Secrets and variables, as one read. */
export type OrgActionsSettings = {
  readonly org: { readonly id: string; readonly handle: string };
  /** Owners and admins manage; members only read. */
  readonly canManage: boolean;
  readonly secrets: readonly OrgSecretSummary[];
  readonly variables: readonly OrgVariableSummary[];
  readonly repositories: readonly OrgRepository[];
  /** The latest changes, newest first (owners and admins only; empty for members). */
  readonly audit: readonly OrgActionsAuditEntry[];
};

/** A secret a repository's jobs may see, with where it comes from (names only). */
export type EffectiveSecret = {
  readonly name: SecretName;
  readonly prelandAllowed: boolean;
  readonly updatedAt: string;
  readonly updatedBy: string;
  readonly source: EntrySource;
  /** An org entry hidden by a repository entry of the same name. */
  readonly overridden: boolean;
};

export type EffectiveVariable = VariableSummary & {
  readonly source: EntrySource;
  readonly overridden: boolean;
};

/** Repository Settings → Secrets and variables: its own entries plus the inherited org ones. */
export type RepoActionsEntries = {
  /** Maintainers and the owner manage the repository's entries. */
  readonly canManage: boolean;
  /** The owning org's handle, when an org owns the repository. */
  readonly orgHandle: string | null;
  readonly secrets: readonly EffectiveSecret[];
  readonly variables: readonly EffectiveVariable[];
};

export const PutVariableInputSchema = z.object({
  name: VariableName,
  value: z.string().max(MAX_VARIABLE_BYTES),
});
export type PutVariableInput = z.input<typeof PutVariableInputSchema>;

export const PutOrgSecretInputSchema = z.object({
  name: SecretName,
  /** Null keeps the stored value (only the access policy or the pre-land toggle change). */
  value: z
    .string()
    .min(1)
    .max(48 * 1024)
    .nullable(),
  access: RepositoryAccessPolicy,
  prelandAllowed: z.boolean(),
});
export type PutOrgSecretInput = z.input<typeof PutOrgSecretInputSchema>;

export const PutOrgVariableInputSchema = PutVariableInputSchema.extend({
  access: RepositoryAccessPolicy,
});
export type PutOrgVariableInput = z.input<typeof PutOrgVariableInputSchema>;

/** The secrets-and-variables RPC on the gateway's `Actions` entrypoint. */
export type ActionsEntriesRpc = {
  /** The repository's own secrets and variables plus the org's that reach it (read role). */
  repoActionsEntries(viewer: Viewer, repoId: string): Promise<RpcResult<RepoActionsEntries>>;
  putVariable(
    viewer: Viewer,
    repoId: string,
    input: PutVariableInput,
  ): Promise<RpcResult<VariableSummary>>;
  deleteVariable(
    viewer: Viewer,
    repoId: string,
    name: string,
  ): Promise<RpcResult<{ readonly deleted: boolean }>>;
  /** Org Settings → Secrets and variables (org members read; owners and admins manage). */
  orgActionsSettings(viewer: Viewer, orgHandle: string): Promise<RpcResult<OrgActionsSettings>>;
  putOrgSecret(
    viewer: Viewer,
    orgHandle: string,
    input: PutOrgSecretInput,
  ): Promise<RpcResult<OrgSecretSummary>>;
  deleteOrgSecret(
    viewer: Viewer,
    orgHandle: string,
    name: string,
  ): Promise<RpcResult<{ readonly deleted: boolean }>>;
  putOrgVariable(
    viewer: Viewer,
    orgHandle: string,
    input: PutOrgVariableInput,
  ): Promise<RpcResult<OrgVariableSummary>>;
  deleteOrgVariable(
    viewer: Viewer,
    orgHandle: string,
    name: string,
  ): Promise<RpcResult<{ readonly deleted: boolean }>>;
};
