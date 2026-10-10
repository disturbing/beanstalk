/**
 * An org's people: members and their roles, invitations by handle (accepted or declined on
 * the invitee's Home), role changes, removals and leaving. Owners and admins manage members;
 * only owners touch the owner role; the last owner can neither leave, be removed nor be
 * demoted (checked inside the write, so two owners leaving at once cannot both succeed).
 */
import { z } from 'zod';

import type { IdentityEnv } from './identity-env';
import type { OrgResult } from './org-admin';
import { refuse, requireCapability } from './org-admin';
import type { OrgActor, OrgAuditEntry } from './org-audit';
import { orgAuditStatement } from './org-audit';
import { OrgRole, findOrgById, orgRole } from './orgs';
import { randomId } from './secrets';

/** Invitations wait two weeks, like repository invitations. */
export const ORG_INVITATION_DAYS = 14;
const DAY_MS = 24 * 3600 * 1000;

export type OrgMember = {
  readonly userId: string;
  readonly handle: string;
  readonly role: OrgRole;
  /** Unix ms: when they joined. */
  readonly since: number;
};

export type OrgInvitation = {
  readonly id: string;
  readonly orgId: string;
  readonly orgHandle: string;
  readonly orgName: string;
  readonly inviteeId: string;
  readonly inviteeHandle: string;
  readonly role: OrgRole;
  readonly invitedByHandle: string;
  readonly createdAt: number;
  readonly expiresAt: number;
};

/** Invite by handle (an `@` and case are ignored) with a role. */
export const OrgInviteInput = z.object({
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .transform((handle) => handle.replace(/^@/, ''))
    .pipe(z.string().min(1, 'Name someone by their handle.').max(39)),
  role: OrgRole,
});
export type OrgInviteInput = z.input<typeof OrgInviteInput>;

export async function orgMembers(env: IdentityEnv, orgId: string): Promise<readonly OrgMember[]> {
  const { results } = await env.IDENTITY_DB.prepare(
    `SELECT m.user_id, u.handle, m.role, m.created_at FROM org_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ? AND u.disabled_at IS NULL
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, u.handle`,
  )
    .bind(orgId)
    .all();
  return results.map((row) => {
    const parsed = MemberRow.parse(row);
    return {
      userId: parsed.user_id,
      handle: parsed.handle,
      role: parsed.role,
      since: parsed.created_at,
    };
  });
}

export async function inviteToOrg(
  env: IdentityEnv,
  input: { readonly actor: OrgActor; readonly orgId: string; readonly invite: OrgInviteInput },
  now: number,
): Promise<OrgResult<OrgInvitation>> {
  const parsed = OrgInviteInput.safeParse(input.invite);
  if (!parsed.success)
    return refuse('invalid', parsed.error.issues[0]?.message ?? 'Check the form.');
  const { actor, orgId } = input;
  const capability = parsed.data.role === 'owner' ? 'owners' : 'members';
  const allowed = await requireCapability(env, actor, orgId, capability);
  if (!allowed.ok) return allowed;
  const invitee = await env.IDENTITY_DB.prepare(
    'SELECT id, handle FROM users WHERE handle = ? AND disabled_at IS NULL',
  )
    .bind(parsed.data.handle)
    .first<{ id: string; handle: string }>();
  if (invitee === null)
    return refuse('unknown_handle', `Nobody on Gitstalk has the handle ${parsed.data.handle}.`);
  if ((await orgRole(env, orgId, invitee.id)) !== null)
    return refuse('already_member', `@${invitee.handle} is already in ${allowed.value.handle}.`);
  const id = randomId('oinv');
  await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare('DELETE FROM org_invitations WHERE org_id = ? AND invitee_id = ?').bind(
      orgId,
      invitee.id,
    ),
    env.IDENTITY_DB.prepare(
      `INSERT INTO org_invitations (id, org_id, invitee_id, role, invited_by_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      orgId,
      invitee.id,
      parsed.data.role,
      actor.id,
      now,
      now + ORG_INVITATION_DAYS * DAY_MS,
    ),
    orgAuditStatement(
      env,
      { orgId, actor, action: 'member.invite', target: invitee, detail: parsed.data.role },
      now,
    ),
  ]);
  const invitation = await invitationById(env, id);
  return invitation === null
    ? refuse('not_found', 'The invitation vanished.')
    : { ok: true, value: invitation };
}

/** Invitations waiting for this person (not expired), newest first. */
export async function orgInvitationsFor(
  env: IdentityEnv,
  userId: string,
  now: number,
): Promise<readonly OrgInvitation[]> {
  const { results } = await env.IDENTITY_DB.prepare(
    `${INVITATION_SELECT} WHERE i.invitee_id = ? AND i.expires_at > ? ORDER BY i.created_at DESC`,
  )
    .bind(userId, now)
    .all();
  return results.map(invitationOf);
}

/** An org's pending invitations, for its owners and admins. */
export async function pendingOrgInvitations(
  env: IdentityEnv,
  orgId: string,
  now: number,
): Promise<readonly OrgInvitation[]> {
  const { results } = await env.IDENTITY_DB.prepare(
    `${INVITATION_SELECT} WHERE i.org_id = ? AND i.expires_at > ? ORDER BY i.created_at DESC`,
  )
    .bind(orgId, now)
    .all();
  return results.map(invitationOf);
}

/** The invitee accepts (becomes a member with the invited role) or declines. */
export async function answerOrgInvitation(
  env: IdentityEnv,
  input: {
    readonly user: OrgActor;
    readonly invitationId: string;
    readonly answer: 'accept' | 'decline';
  },
  now: number,
): Promise<OrgResult<{ readonly orgHandle: string }>> {
  const invitation = await invitationById(env, input.invitationId);
  if (invitation === null || invitation.inviteeId !== input.user.id || invitation.expiresAt <= now)
    return refuse('not_found', 'No such invitation.');
  const drop = env.IDENTITY_DB.prepare('DELETE FROM org_invitations WHERE id = ?').bind(
    invitation.id,
  );
  const audit: OrgAuditEntry = {
    orgId: invitation.orgId,
    actor: input.user,
    action: input.answer === 'accept' ? 'member.accept' : 'member.decline',
    detail: invitation.role,
  };
  const join = env.IDENTITY_DB.prepare(
    `INSERT INTO org_members (org_id, user_id, role, added_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (org_id, user_id) DO NOTHING`,
  ).bind(invitation.orgId, input.user.id, invitation.role, input.user.id, now, now);
  await env.IDENTITY_DB.batch(
    input.answer === 'accept'
      ? [join, drop, orgAuditStatement(env, audit, now)]
      : [drop, orgAuditStatement(env, audit, now)],
  );
  return { ok: true, value: { orgHandle: invitation.orgHandle } };
}

export async function cancelOrgInvitation(
  env: IdentityEnv,
  input: { readonly actor: OrgActor; readonly orgId: string; readonly invitationId: string },
  now: number,
): Promise<OrgResult<{ readonly cancelled: true }>> {
  const allowed = await requireCapability(env, input.actor, input.orgId, 'members');
  if (!allowed.ok) return allowed;
  const invitation = await invitationById(env, input.invitationId);
  if (invitation === null || invitation.orgId !== input.orgId)
    return refuse('not_found', 'No such invitation.');
  await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare('DELETE FROM org_invitations WHERE id = ?').bind(invitation.id),
    orgAuditStatement(
      env,
      {
        orgId: input.orgId,
        actor: input.actor,
        action: 'member.invite_cancel',
        target: { id: invitation.inviteeId, handle: invitation.inviteeHandle },
      },
      now,
    ),
  ]);
  return { ok: true, value: { cancelled: true } };
}

/** Changes a member's role; the owner role (to or from) needs an owner, and one owner stays. */
export async function setOrgMemberRole(
  env: IdentityEnv,
  input: {
    readonly actor: OrgActor;
    readonly orgId: string;
    readonly userId: string;
    readonly role: OrgRole;
  },
  now: number,
): Promise<OrgResult<OrgMember>> {
  const role = OrgRole.safeParse(input.role);
  if (!role.success) return refuse('invalid', 'Pick owner, admin, member or viewer.');
  const target = await memberOf(env, input.orgId, input.userId);
  const touchesOwner = role.data === 'owner' || target?.role === 'owner';
  const allowed = await requireCapability(
    env,
    input.actor,
    input.orgId,
    touchesOwner ? 'owners' : 'members',
  );
  if (!allowed.ok) return allowed;
  if (target === null) return refuse('not_found', 'They are not a member.');
  const changed = await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare(
      `UPDATE org_members SET role = ?1, updated_at = ?2 WHERE org_id = ?3 AND user_id = ?4
         AND (?1 = 'owner' OR role <> 'owner'
              OR (SELECT COUNT(*) FROM org_members WHERE org_id = ?3 AND role = 'owner') > 1)`,
    ).bind(role.data, now, input.orgId, input.userId),
  ]);
  if ((changed[0]?.meta.changes ?? 0) === 0) return lastOwner(allowed.value.handle);
  await orgAuditStatement(
    env,
    {
      orgId: input.orgId,
      actor: input.actor,
      action: 'member.role',
      target: { id: target.userId, handle: target.handle },
      detail: `${target.role} → ${role.data}`,
    },
    now,
  ).run();
  return { ok: true, value: { ...target, role: role.data } };
}

/**
 * Removes a member (owners and admins; an owner only by an owner), or the actor themself
 * (leaving, any member). The last owner stays.
 */
export async function removeOrgMember(
  env: IdentityEnv,
  input: { readonly actor: OrgActor; readonly orgId: string; readonly userId: string },
  now: number,
): Promise<OrgResult<{ readonly removed: true }>> {
  const target = await memberOf(env, input.orgId, input.userId);
  const isLeaving = input.actor.id === input.userId;
  const org = await findOrgById(env, input.orgId);
  if (org === null) return refuse('not_found', 'No such organization.');
  if (!isLeaving) {
    const capability = target?.role === 'owner' ? 'owners' : 'members';
    const allowed = await requireCapability(env, input.actor, input.orgId, capability);
    if (!allowed.ok) return allowed;
  }
  if (target === null) return refuse('not_found', 'They are not a member.');
  const [removed] = await env.IDENTITY_DB.batch([
    env.IDENTITY_DB.prepare(
      `DELETE FROM org_members WHERE org_id = ?1 AND user_id = ?2
         AND (role <> 'owner' OR (SELECT COUNT(*) FROM org_members WHERE org_id = ?1 AND role = 'owner') > 1)`,
    ).bind(input.orgId, input.userId),
  ]);
  if ((removed?.meta.changes ?? 0) === 0) return lastOwner(org.handle);
  await orgAuditStatement(
    env,
    {
      orgId: input.orgId,
      actor: input.actor,
      action: isLeaving ? 'member.leave' : 'member.remove',
      target: { id: target.userId, handle: target.handle },
      detail: target.role,
    },
    now,
  ).run();
  return { ok: true, value: { removed: true } };
}

async function memberOf(
  env: IdentityEnv,
  orgId: string,
  userId: string,
): Promise<OrgMember | null> {
  const row = await env.IDENTITY_DB.prepare(
    `SELECT m.user_id, u.handle, m.role, m.created_at FROM org_members m
     JOIN users u ON u.id = m.user_id WHERE m.org_id = ? AND m.user_id = ?`,
  )
    .bind(orgId, userId)
    .first();
  if (row === null) return null;
  const parsed = MemberRow.parse(row);
  return {
    userId: parsed.user_id,
    handle: parsed.handle,
    role: parsed.role,
    since: parsed.created_at,
  };
}

async function invitationById(env: IdentityEnv, id: string): Promise<OrgInvitation | null> {
  const row = await env.IDENTITY_DB.prepare(`${INVITATION_SELECT} WHERE i.id = ?`).bind(id).first();
  return row === null ? null : invitationOf(row);
}

function lastOwner(handle: string): { ok: false; error: { code: 'last_owner'; message: string } } {
  return {
    ok: false,
    error: {
      code: 'last_owner',
      message: `${handle} needs at least one owner: make someone else an owner first.`,
    },
  };
}

const INVITATION_SELECT = `SELECT i.id, i.org_id, o.handle AS org_handle, o.name AS org_name,
  i.invitee_id, u.handle AS invitee_handle, i.role, b.handle AS invited_by_handle,
  i.created_at, i.expires_at
  FROM org_invitations i JOIN orgs o ON o.id = i.org_id JOIN users u ON u.id = i.invitee_id
  LEFT JOIN users b ON b.id = i.invited_by_id`;

const MemberRow = z.object({
  user_id: z.string(),
  handle: z.string(),
  role: OrgRole,
  created_at: z.number(),
});

const InvitationRow = z.object({
  id: z.string(),
  org_id: z.string(),
  org_handle: z.string(),
  org_name: z.string(),
  invitee_id: z.string(),
  invitee_handle: z.string(),
  role: OrgRole,
  invited_by_handle: z.string().nullable(),
  created_at: z.number(),
  expires_at: z.number(),
});

function invitationOf(row: unknown): OrgInvitation {
  const parsed = InvitationRow.parse(row);
  return {
    id: parsed.id,
    orgId: parsed.org_id,
    orgHandle: parsed.org_handle,
    orgName: parsed.org_name,
    inviteeId: parsed.invitee_id,
    inviteeHandle: parsed.invitee_handle,
    role: parsed.role,
    invitedByHandle: parsed.invited_by_handle ?? 'someone',
    createdAt: parsed.created_at,
    expiresAt: parsed.expires_at,
  };
}
