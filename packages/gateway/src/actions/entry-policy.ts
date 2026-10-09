/**
 * Which secrets and variables a repository's jobs see (doc 25 §3.4, GitHub's model): the org
 * entries whose access policy reaches the repository, then the repository's own, which win on
 * a name clash. Pure; the stores and the run supply the rows.
 */
import type { RepositoryAccessPolicy } from '@beanstalk/shared-race/actions-secrets';

/** The facts about a repository an org policy is decided on. */
export type PolicyTarget = { readonly id: string; readonly visibility: 'public' | 'private' };

/** Whether an org entry with `policy` reaches `repo`. */
export function policyReaches(policy: RepositoryAccessPolicy, repo: PolicyTarget): boolean {
  switch (policy.kind) {
    case 'all':
      return true;
    case 'private':
      return repo.visibility === 'private';
    case 'selected':
      return policy.repoIds.includes(repo.id);
    default:
      return assertNever(policy);
  }
}

/** One entry as the resolver sees it: a name, where it is from, and the rest untouched. */
export type Sourced<T> = T & {
  readonly name: string;
  readonly from: 'repository' | 'organization';
  /** An org entry hidden by a repository entry of the same name. */
  readonly overridden: boolean;
};

/**
 * Every entry a repository sees, repository entries first then the reaching org ones, sorted
 * by name within each; org entries the repository overrides are kept, marked `overridden`, so
 * Settings can say so. `effectiveOnly` drops them for a job.
 */
export function resolveEntries<T extends { readonly name: string }>(input: {
  readonly repo: PolicyTarget;
  readonly repoEntries: readonly T[];
  readonly orgEntries: readonly (T & { readonly access: RepositoryAccessPolicy })[];
}): Sourced<T>[] {
  const own = new Set(input.repoEntries.map((entry) => entry.name));
  const repository = input.repoEntries
    .map((entry): Sourced<T> => ({ ...entry, from: 'repository', overridden: false }))
    .toSorted(byName);
  const organization = input.orgEntries
    .filter((entry) => policyReaches(entry.access, input.repo))
    .map((entry): Sourced<T> => ({
      ...entry,
      from: 'organization',
      overridden: own.has(entry.name),
    }))
    .toSorted(byName);
  return [...repository, ...organization];
}

/** The entries a job gets: one per name, the repository's where both exist. */
export function effectiveOnly<T>(entries: readonly Sourced<T>[]): Sourced<T>[] {
  return entries.filter((entry) => !entry.overridden);
}

function byName(a: { readonly name: string }, b: { readonly name: string }): number {
  if (a.name === b.name) return 0;
  return a.name < b.name ? -1 : 1;
}

function assertNever(value: never): never {
  throw new Error(`unexpected access policy ${JSON.stringify(value)}`);
}
