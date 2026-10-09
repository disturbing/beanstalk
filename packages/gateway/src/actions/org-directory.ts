/**
 * The one adapter between Actions' org secrets and variables and organizations
 * (`@beanstalk/shared-identity/orgs`, doc 28): who owns a repository, an org by handle, and a
 * person's org role. Owners and admins hold the `secrets` capability (`mayInOrg`) and manage
 * org entries; every other member reads them. Everything in Actions asks `OrgDirectory`, so a
 * test can hand in a fixed directory.
 */
import type { OrgRole, RepositoryOwnerRef } from '@beanstalk/shared-identity/orgs';
import {
  findOrgByHandle,
  isOrgId,
  mayInOrg,
  orgRole,
  ownerOf,
} from '@beanstalk/shared-identity/orgs';

export type { OrgRole } from '@beanstalk/shared-identity/orgs';

export type Org = { readonly id: string; readonly handle: string };

/** A repository as far as its owner goes; records from before orgs carry no `owner_kind`. */
export type OwnedRepository = {
  readonly owner: { readonly id: string; readonly handle: string };
  readonly owner_kind?: 'user' | 'org' | undefined;
};

export type OrgDirectory = {
  orgByHandle(handle: string): Promise<Org | null>;
  orgRole(orgId: string, userId: string): Promise<OrgRole | null>;
  ownerOf(repo: OwnedRepository): RepositoryOwnerRef;
};

/** Whether `role` may add, change or delete the org's secrets and variables. */
export function managesOrgEntries(role: OrgRole | null): boolean {
  return mayInOrg(role, 'secrets');
}

/** The deployment's org directory: lane O's registry in IDENTITY_DB. */
export function orgDirectoryOf(env: Pick<Env, 'IDENTITY_DB'>): OrgDirectory {
  return {
    orgByHandle: async (handle) => {
      const org = await findOrgByHandle(env, handle);
      return org === null ? null : { id: org.id, handle: org.handle };
    },
    orgRole: (orgId, userId) => orgRole(env, orgId, userId),
    ownerOf: (repo) => ownerOfAny(repo),
  };
}

/** A directory over a fixed list of orgs (unit tests). */
export function staticOrgDirectory(
  orgs: readonly (Org & { readonly members: Readonly<Record<string, OrgRole>> })[],
): OrgDirectory {
  return {
    orgByHandle: async (handle) => {
      const wanted = handle.replace(/^@/, '').toLowerCase();
      const found = orgs.find((org) => org.handle.toLowerCase() === wanted);
      return found === undefined ? null : { id: found.id, handle: found.handle };
    },
    orgRole: async (orgId, userId) => orgs.find((org) => org.id === orgId)?.members[userId] ?? null,
    ownerOf: (repo) => ownerOfAny(repo),
  };
}

/**
 * `ownerOf`, also for facts without `owner_kind` (a run's frozen repository facts): an owner id
 * of the form `org_…` names an org.
 */
function ownerOfAny(repo: OwnedRepository): RepositoryOwnerRef {
  return ownerOf({
    owner: repo.owner,
    owner_kind: repo.owner_kind ?? (isOrgId(repo.owner.id) ? 'org' : 'user'),
  });
}
