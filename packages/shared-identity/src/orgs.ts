/**
 * Organizations, the shared contract (`docs/claude-opus/28-organizations.md`). An org is a
 * handle in the same namespace as people's (`/<handle>` is a person or an org, never both),
 * with members in four roles. Repositories are owned by a person or an org; the gateway's
 * `mayUseEngine` turns a person's org role and the org's base permission into a repository
 * role. This module is what other lanes import: the types, `orgRole`, `ownerOf`, and which
 * org roles may do what (`mayInOrg`). Changing orgs lives in `org-admin.ts` and
 * `org-members.ts`.
 */
import { z } from 'zod';

import type { IdentityEnv } from './identity-env';
import { Handle } from './users';

/**
 * A member's role, strongest first:
 * - `owner`: everything, the org's deletion and other owners included; at least one always;
 * - `admin`: settings, secrets, members (not owners), every repository as its owner;
 * - `member`: the org's base permission on every repository (none by default: only the
 *   repositories they are invited to), creates repositories when the org allows it;
 * - `viewer`: the base permission capped at read.
 * Every role reads the org's internal repositories.
 */
export const ORG_ROLES = ['owner', 'admin', 'member', 'viewer'] as const;
export const OrgRole = z.enum(ORG_ROLES);
export type OrgRole = z.infer<typeof OrgRole>;

/** What every member may do with every org repository before collaborator roles add more. */
export const ORG_BASE_PERMISSIONS = ['none', 'read', 'write'] as const;
export const OrgBasePermission = z.enum(ORG_BASE_PERMISSIONS);
export type OrgBasePermission = z.infer<typeof OrgBasePermission>;
/**
 * A new org's base permission (owner's decision 2026-10-09): none, so members reach only the
 * repositories they are invited to, plus the org's internal and public ones. Owners and admins
 * reach every repository regardless.
 */
export const DEFAULT_BASE_PERMISSION: OrgBasePermission = 'none';

/** Who may create repositories in the org (owners and admins always may). */
export const OrgRepoCreation = z.enum(['members', 'admins']);
export type OrgRepoCreation = z.infer<typeof OrgRepoCreation>;

export const OrgId = z
  .string()
  .regex(/^org_[A-Za-z0-9_-]+$/)
  .brand<'OrgId'>();
export type OrgId = z.infer<typeof OrgId>;

export type Org = {
  readonly id: OrgId;
  readonly handle: string;
  readonly name: string;
  readonly description: string;
  /** The uploaded icon's key (the uploads API serves it); null shows the initials. */
  readonly iconKey: string | null;
  readonly basePermission: OrgBasePermission;
  readonly repoCreation: OrgRepoCreation;
  readonly defaultVisibility: 'public' | 'private';
  readonly createdAt: number;
};

/** A person's place in an org, as the access rule needs it. */
export type OrgStanding = {
  readonly role: OrgRole;
  readonly basePermission: OrgBasePermission;
};

/** Who owns a repository: a person or an org. */
export type OwnerKind = 'user' | 'org';
export type RepositoryOwnerRef = {
  readonly kind: OwnerKind;
  readonly id: string;
  readonly handle: string;
};

/**
 * What an org role may do in the org itself (repository access is `mayUseEngine`'s):
 * - `settings`: name, description, icon, repository defaults, base permission;
 * - `secrets`: org-level Actions secrets and variables;
 * - `members`: invite, cancel, change roles and remove (members, viewers and admins);
 * - `owners`: grant or take the owner role, remove an owner;
 * - `delete`: delete the org (once it owns no repositories);
 * - `audit`: read the org's audit log;
 * - `transfer-in`: move a repository into the org;
 * - `see-members`: the member list on the org page.
 */
export type OrgCapability =
  | 'settings'
  | 'secrets'
  | 'members'
  | 'owners'
  | 'delete'
  | 'audit'
  | 'transfer-in'
  | 'see-members';

const CAPABILITIES: Readonly<Record<OrgRole, ReadonlySet<OrgCapability>>> = {
  owner: new Set<OrgCapability>([
    'settings',
    'secrets',
    'members',
    'owners',
    'delete',
    'audit',
    'transfer-in',
    'see-members',
  ]),
  admin: new Set<OrgCapability>([
    'settings',
    'secrets',
    'members',
    'audit',
    'transfer-in',
    'see-members',
  ]),
  member: new Set<OrgCapability>(['see-members']),
  viewer: new Set<OrgCapability>(['see-members']),
};

/** Whether `role` (null: not a member) may do `capability` in the org. */
export function mayInOrg(role: OrgRole | null, capability: OrgCapability): boolean {
  return role !== null && CAPABILITIES[role].has(capability);
}

/** Whether `role` may create a repository in an org with this setting. */
export function mayCreateRepository(role: OrgRole | null, creation: OrgRepoCreation): boolean {
  if (role === 'owner' || role === 'admin') return true;
  return role === 'member' && creation === 'members';
}

/** The new org form, validated: a handle (people's rules), a name, a description. */
export const CreateOrgInput = z.object({
  handle: Handle,
  name: z.string().trim().min(1, 'Give the organization a name.').max(80),
  description: z.string().trim().max(350).default(''),
});
export type CreateOrgInput = z.input<typeof CreateOrgInput>;

/** Settings changes; every field optional, at least one present. */
export const UpdateOrgInput = z
  .object({
    name: z.string().trim().min(1, 'Give the organization a name.').max(80).optional(),
    description: z.string().trim().max(350).optional(),
    /** An uploaded icon's key (@gitstalk/shared-media: `orgs/<id>/icon/<hash>`), or null. */
    iconKey: z
      .string()
      .regex(/^orgs\/[A-Za-z0-9_-]{1,64}\/icon\/[0-9a-f]{32}$/, 'not an icon key')
      .nullable()
      .optional(),
    basePermission: OrgBasePermission.optional(),
    repoCreation: OrgRepoCreation.optional(),
    defaultVisibility: z.enum(['public', 'private']).optional(),
  })
  .refine(
    (patch) => Object.values(patch).some((value) => value !== undefined),
    'Change something.',
  );
export type UpdateOrgInput = z.input<typeof UpdateOrgInput>;

/** `userId`'s role in the org, or null when they are not a member (or the org is gone). */
export async function orgRole(
  env: IdentityEnv,
  orgId: string,
  userId: string,
): Promise<OrgRole | null> {
  return (await orgStanding(env, orgId, userId))?.role ?? null;
}

/** `userId`'s role and the org's base permission in one read; null when not a member. */
export async function orgStanding(
  env: IdentityEnv,
  orgId: string,
  userId: string,
): Promise<OrgStanding | null> {
  const row = await env.IDENTITY_DB.prepare(
    `SELECT m.role, o.base_permission FROM org_members m JOIN orgs o ON o.id = m.org_id
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ? AND m.user_id = ? AND u.disabled_at IS NULL`,
  )
    .bind(orgId, userId)
    .first();
  const parsed = StandingRow.safeParse(row);
  return parsed.success
    ? { role: parsed.data.role, basePermission: parsed.data.base_permission }
    : null;
}

/**
 * Who owns a repository record. Records from before orgs carry no `owner_kind`: a person's.
 */
export function ownerOf(repo: {
  readonly owner: { readonly id: string; readonly handle: string };
  readonly owner_kind?: OwnerKind | undefined;
}): RepositoryOwnerRef {
  return { kind: repo.owner_kind ?? 'user', id: repo.owner.id, handle: repo.owner.handle };
}

/** Whether an owner id names an org (`org_…`) rather than a person (`u_…`). */
export function isOrgId(id: string): boolean {
  return id.startsWith('org_');
}

export async function findOrgByHandle(env: IdentityEnv, handle: string): Promise<Org | null> {
  const row = await env.IDENTITY_DB.prepare(`SELECT ${ORG_COLUMNS} FROM orgs WHERE handle = ?`)
    .bind(handle.trim().replace(/^@/, ''))
    .first();
  return row === null ? null : orgOf(row);
}

export async function findOrgById(env: IdentityEnv, id: string): Promise<Org | null> {
  const row = await env.IDENTITY_DB.prepare(`SELECT ${ORG_COLUMNS} FROM orgs WHERE id = ?`)
    .bind(id)
    .first();
  return row === null ? null : orgOf(row);
}

/** The person or org a handle names (any case), or null; disabled people are nobody. */
export async function ownerByHandle(
  env: IdentityEnv,
  handle: string,
): Promise<RepositoryOwnerRef | null> {
  const row = await env.IDENTITY_DB.prepare(
    `SELECT 'user' AS kind, id, handle FROM users WHERE handle = ?1 AND disabled_at IS NULL
     UNION ALL SELECT 'org' AS kind, id, handle FROM orgs WHERE handle = ?1 LIMIT 1`,
  )
    .bind(handle.trim().replace(/^@/, ''))
    .first();
  const parsed = OwnerRow.safeParse(row);
  return parsed.success ? parsed.data : null;
}

/** An org a person belongs to, with their role. */
export type Membership = { readonly org: Org; readonly role: OrgRole };

/** The orgs `userId` belongs to, by handle. */
export async function orgsOf(env: IdentityEnv, userId: string): Promise<readonly Membership[]> {
  const { results } = await env.IDENTITY_DB.prepare(
    `SELECT ${ORG_COLUMNS_OF('o')}, m.role AS member_role FROM org_members m
     JOIN orgs o ON o.id = m.org_id WHERE m.user_id = ? ORDER BY o.handle`,
  )
    .bind(userId)
    .all();
  return results.map((row) => ({
    org: orgOf(row),
    role: OrgRole.parse(Reflect.get(row, 'member_role')),
  }));
}

const ORG_COLUMNS_OF = (alias: string): string =>
  [
    'id',
    'handle',
    'name',
    'description',
    'icon_key',
    'base_permission',
    'repo_creation',
    'default_visibility',
    'created_at',
  ]
    .map((column) => `${alias}.${column}`)
    .join(', ');
const ORG_COLUMNS = ORG_COLUMNS_OF('orgs');

const OrgRow = z.object({
  id: OrgId,
  handle: z.string(),
  name: z.string(),
  description: z.string(),
  icon_key: z.string().nullable(),
  base_permission: OrgBasePermission,
  repo_creation: OrgRepoCreation,
  default_visibility: z.enum(['public', 'private']),
  created_at: z.number(),
});

const StandingRow = z.object({ role: OrgRole, base_permission: OrgBasePermission });
const OwnerRow = z.object({ kind: z.enum(['user', 'org']), id: z.string(), handle: z.string() });

/** A stored org row as an `Org`. */
export function orgOf(row: unknown): Org {
  const parsed = OrgRow.parse(row);
  return {
    id: parsed.id,
    handle: parsed.handle,
    name: parsed.name,
    description: parsed.description,
    iconKey: parsed.icon_key,
    basePermission: parsed.base_permission,
    repoCreation: parsed.repo_creation,
    defaultVisibility: parsed.default_visibility,
    createdAt: parsed.created_at,
  };
}
