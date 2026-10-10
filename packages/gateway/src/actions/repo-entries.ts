/**
 * Everything a repository sees of Actions secrets and variables: its own entries plus those of
 * the org that owns it, filtered by each org entry's access policy, the repository's entry
 * winning on a name clash (`entry-policy.ts`). The run DO uses it to pick and reveal a job's
 * secrets and to fill `vars`; the RPC uses it for Settings.
 */
import type { SecretSummary } from '@gitstalk/shared-race/actions';
import type {
  OrgSecretSummary,
  OrgVariableSummary,
  VariableSummary,
} from '@gitstalk/shared-race/actions-secrets';

import type { PolicyTarget, Sourced } from './entry-policy';
import { effectiveOnly, resolveEntries } from './entry-policy';
import { secretsKeyOf } from './actions-config';
import type { OrgDirectory } from './org-directory';
import type { RepositoryOwnerRef } from '@gitstalk/shared-identity/orgs';
import { orgDirectoryOf } from './org-directory';
import type { OrgSecretsStore } from './org-secrets';
import { d1OrgSecrets } from './org-secrets';
import type { SecretsStore } from './secrets';
import { d1Secrets } from './secrets';
import type { VariablesStore } from './variables';
import { d1Variables } from './variables';

export type EntryStores = {
  readonly secrets: SecretsStore;
  readonly orgSecrets: OrgSecretsStore;
  readonly variables: VariablesStore;
  readonly orgs: OrgDirectory;
};

/** The deployment's stores and org directory. */
export function entryStoresOf(env: Env): EntryStores {
  const key = secretsKeyOf(env);
  return {
    secrets: d1Secrets(env.FORGE, key),
    orgSecrets: d1OrgSecrets(env.FORGE, key),
    variables: d1Variables(env.FORGE),
    orgs: orgDirectoryOf(env),
  };
}

/** The repository facts resolution needs. */
export type EntryRepo = PolicyTarget & {
  readonly owner: { readonly id: string; readonly handle: string };
  /** Absent on a run's frozen facts: an `org_…` owner id then names an org. */
  readonly owner_kind?: 'user' | 'org' | undefined;
};

type SecretRow = Omit<SecretSummary, 'name'> & { readonly name: string };
type OrgSecretRow = Omit<OrgSecretSummary, 'name'> & { readonly name: string };
type VariableRow = Omit<VariableSummary, 'name'> & { readonly name: string };
type OrgVariableRow = Omit<OrgVariableSummary, 'name'> & { readonly name: string };

export type RepoSecretEntries = {
  readonly owner: RepositoryOwnerRef;
  readonly entries: readonly Sourced<SecretRow>[];
};

export type RepoVariableEntries = {
  readonly owner: RepositoryOwnerRef;
  readonly entries: readonly Sourced<VariableRow>[];
};

/** The repository's secrets and the reaching org secrets (names and flags, never values). */
export async function repoSecretEntries(
  stores: EntryStores,
  repo: EntryRepo,
): Promise<RepoSecretEntries> {
  const owner = stores.orgs.ownerOf(repo);
  const [repoEntries, orgEntries] = await Promise.all([
    stores.secrets.list(repo.id),
    owner.kind === 'org' ? stores.orgSecrets.list(owner.id) : Promise.resolve<OrgSecretRow[]>([]),
  ]);
  return { owner, entries: resolveEntries<SecretRow>({ repo, repoEntries, orgEntries }) };
}

/** The repository's variables and the reaching org variables. */
export async function repoVariableEntries(
  stores: EntryStores,
  repo: EntryRepo,
): Promise<RepoVariableEntries> {
  const owner = stores.orgs.ownerOf(repo);
  const [repoEntries, orgEntries] = await Promise.all([
    stores.variables.listRepo(repo.id),
    owner.kind === 'org'
      ? stores.variables.listOrg(owner.id)
      : Promise.resolve<OrgVariableRow[]>([]),
  ]);
  return { owner, entries: resolveEntries<VariableRow>({ repo, repoEntries, orgEntries }) };
}

/** `vars` for a job of this repository: every effective variable by name. */
export async function jobVariables(
  stores: EntryStores,
  repo: EntryRepo,
): Promise<Record<string, string>> {
  const { entries } = await repoVariableEntries(stores, repo);
  return Object.fromEntries(effectiveOnly(entries).map((entry) => [entry.name, entry.value]));
}

/**
 * The secrets a job of this repository could get (one per name, the repository's winning),
 * for D4's `secretsForRun`, and how to reveal the chosen ones from where each one lives.
 */
export async function jobSecretCatalog(
  stores: EntryStores,
  repo: EntryRepo,
): Promise<{
  readonly stored: readonly { readonly name: string; readonly prelandAllowed: boolean }[];
  readonly reveal: (names: readonly string[]) => Promise<Record<string, string>>;
}> {
  const { owner, entries } = await repoSecretEntries(stores, repo);
  const effective = effectiveOnly(entries);
  const from = new Map(effective.map((entry) => [entry.name, entry.from]));
  return {
    stored: effective.map((entry) => ({ name: entry.name, prelandAllowed: entry.prelandAllowed })),
    reveal: async (names) => {
      const own = names.filter((name) => from.get(name) === 'repository');
      const inherited = names.filter((name) => from.get(name) === 'organization');
      const [repoValues, orgValues] = await Promise.all([
        stores.secrets.reveal(repo.id, own),
        owner.kind === 'org' ? stores.orgSecrets.reveal(owner.id, inherited) : Promise.resolve({}),
      ]);
      return { ...orgValues, ...repoValues };
    },
  };
}
