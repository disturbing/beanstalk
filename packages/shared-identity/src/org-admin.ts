/**
 * Creating, changing and deleting orgs. The creator becomes the first owner in the same batch
 * as the org; settings are owners' and admins'; deletion is owners' only, and the caller
 * (the web app) first makes sure the org owns no repositories, which live in another database.
 */
import type { IdentityEnv } from './identity-env';
import type { OrgActor } from './org-audit';
import { orgAuditStatement } from './org-audit';
import type { Org, OrgCapability } from './orgs';
import { CreateOrgInput, UpdateOrgInput, findOrgById, mayInOrg, orgRole } from './orgs';
import { randomId } from './secrets';
import { isUniqueViolation } from './users';

export type OrgErrorCode =
  | 'invalid'
  | 'handle_taken'
  | 'not_found'
  | 'forbidden'
  | 'last_owner'
  | 'unknown_handle'
  | 'already_member';

export type OrgError = { readonly code: OrgErrorCode; readonly message: string };
export type OrgResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: OrgError };

export async function createOrg(
  env: IdentityEnv,
  creator: OrgActor,
  input: CreateOrgInput,
  now: number,
): Promise<OrgResult<Org>> {
  const parsed = CreateOrgInput.safeParse(input);
  if (!parsed.success)
    return refuse('invalid', parsed.error.issues[0]?.message ?? 'Check the form.');
  const { handle, name, description } = parsed.data;
  const id = randomId('org');
  try {
    await env.IDENTITY_DB.batch([
      env.IDENTITY_DB.prepare(
        `INSERT INTO orgs (id, handle, name, description, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, handle, name, description, creator.id, now, now),
      env.IDENTITY_DB.prepare(
        `INSERT INTO org_members (org_id, user_id, role, added_by, created_at, updated_at)
         VALUES (?, ?, 'owner', ?, ?, ?)`,
      ).bind(id, creator.id, creator.id, now, now),
      orgAuditStatement(
        env,
        { orgId: id, actor: creator, action: 'org.create', detail: handle },
        now,
      ),
    ]);
  } catch (error: unknown) {
    if (isUniqueViolation(error)) return refuse('handle_taken', `${handle} is already taken.`);
    throw error;
  }
  const org = await findOrgById(env, id);
  return org === null
    ? refuse('not_found', 'The organization vanished.')
    : { ok: true, value: org };
}

/** Applies a settings change; owners and admins only. */
export async function updateOrg(
  env: IdentityEnv,
  actor: OrgActor,
  orgId: string,
  patch: UpdateOrgInput,
  now: number,
): Promise<OrgResult<Org>> {
  const parsed = UpdateOrgInput.safeParse(patch);
  if (!parsed.success)
    return refuse('invalid', parsed.error.issues[0]?.message ?? 'Check the form.');
  const allowed = await requireCapability(env, actor, orgId, 'settings');
  if (!allowed.ok) return allowed;
  const before = allowed.value;
  const change = parsed.data;
  // An org's icon is its own upload, never another org's object.
  if (typeof change.iconKey === 'string' && !change.iconKey.startsWith(`orgs/${orgId}/icon/`))
    return refuse('invalid', 'That icon belongs to another organization.');
  const after = {
    name: change.name ?? before.name,
    description: change.description ?? before.description,
    iconKey: change.iconKey === undefined ? before.iconKey : change.iconKey,
    basePermission: change.basePermission ?? before.basePermission,
    repoCreation: change.repoCreation ?? before.repoCreation,
    defaultVisibility: change.defaultVisibility ?? before.defaultVisibility,
  };
  await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare(
      `UPDATE orgs SET name = ?, description = ?, icon_key = ?, base_permission = ?,
         repo_creation = ?, default_visibility = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      after.name,
      after.description,
      after.iconKey,
      after.basePermission,
      after.repoCreation,
      after.defaultVisibility,
      now,
      orgId,
    ),
    orgAuditStatement(
      env,
      { orgId, actor, action: 'org.settings', detail: settingsDetail(before, after) },
      now,
    ),
  ]);
  return { ok: true, value: { ...before, ...after } };
}

/**
 * Deletes the org, its members and invitations; owners only. The caller checks first that it
 * owns no repositories (they live in the registry, not here). The audit log stays.
 */
export async function deleteOrg(
  env: IdentityEnv,
  actor: OrgActor,
  orgId: string,
  now: number,
): Promise<OrgResult<{ readonly deleted: true }>> {
  const allowed = await requireCapability(env, actor, orgId, 'delete');
  if (!allowed.ok) return allowed;
  await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare('DELETE FROM org_invitations WHERE org_id = ?').bind(orgId),
    env.IDENTITY_DB.prepare('DELETE FROM org_members WHERE org_id = ?').bind(orgId),
    env.IDENTITY_DB.prepare('DELETE FROM orgs WHERE id = ?').bind(orgId),
    orgAuditStatement(
      env,
      { orgId, actor, action: 'org.delete', detail: allowed.value.handle },
      now,
    ),
  ]);
  return { ok: true, value: { deleted: true } };
}

/**
 * The org when `actor` may do `capability` in it: not found for people outside it (an org's
 * members and settings are not public), forbidden for members whose role does not reach.
 */
export async function requireCapability(
  env: IdentityEnv,
  actor: OrgActor,
  orgId: string,
  capability: OrgCapability,
): Promise<OrgResult<Org>> {
  const [org, role] = await Promise.all([findOrgById(env, orgId), orgRole(env, orgId, actor.id)]);
  if (org === null || role === null) return refuse('not_found', 'No such organization.');
  if (!mayInOrg(role, capability))
    return refuse('forbidden', `${NEEDS[capability]}; you are ${article(role)} ${role}.`);
  return { ok: true, value: org };
}

export function refuse(code: OrgErrorCode, message: string): { ok: false; error: OrgError } {
  return { ok: false, error: { code, message } };
}

const NEEDS: Readonly<Record<OrgCapability, string>> = {
  settings: 'Only owners and admins change the organization’s settings',
  secrets: 'Only owners and admins manage the organization’s secrets',
  members: 'Only owners and admins manage members',
  owners: 'Only owners grant, change or remove the owner role',
  delete: 'Only owners delete the organization',
  audit: 'Only owners and admins read the audit log',
  'transfer-in': 'Only owners and admins move repositories into the organization',
  'see-members': 'Only members see who else is',
};

function article(role: string): string {
  return /^[aeiou]/.test(role) ? 'an' : 'a';
}

function settingsDetail(before: Org, after: Omit<Org, 'id' | 'handle' | 'createdAt'>): string {
  const changed: string[] = [];
  if (before.name !== after.name) changed.push('name');
  if (before.description !== after.description) changed.push('description');
  if (before.iconKey !== after.iconKey) changed.push('icon');
  if (before.basePermission !== after.basePermission)
    changed.push(`base permission ${before.basePermission} → ${after.basePermission}`);
  if (before.repoCreation !== after.repoCreation)
    changed.push(`repository creation: ${after.repoCreation}`);
  if (before.defaultVisibility !== after.defaultVisibility)
    changed.push(`default visibility ${after.defaultVisibility}`);
  return changed.length === 0 ? 'no change' : changed.join(', ');
}
