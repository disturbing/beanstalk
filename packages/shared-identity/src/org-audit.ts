/**
 * An org's audit log (`org_audit`): who created it, changed its settings, invited, answered,
 * changed a role, removed or left, and moved repositories in or out. Each line is written in
 * the same D1 batch as the change it records. Never carries a secret.
 */
import type { IdentityEnv } from './identity-env';

export type OrgAuditAction =
  | 'org.create'
  | 'org.settings'
  | 'org.delete'
  | 'member.invite'
  | 'member.invite_cancel'
  | 'member.accept'
  | 'member.decline'
  | 'member.role'
  | 'member.remove'
  | 'member.leave'
  | 'repository.transfer_in'
  | 'repository.transfer_out'
  | 'repository.create';

export type OrgActor = { readonly id: string; readonly handle: string };

export type OrgAuditEntry = {
  readonly orgId: string;
  readonly actor: OrgActor;
  readonly action: OrgAuditAction;
  readonly target?: OrgActor;
  readonly detail?: string;
};

export type OrgAuditEvent = {
  readonly at: number;
  readonly actorHandle: string;
  readonly action: string;
  readonly targetHandle: string | null;
  readonly detail: string;
};

const LIST_LIMIT = 100;

/** The statement that writes one line; batch it with the change. */
export function orgAuditStatement(
  env: IdentityEnv,
  entry: OrgAuditEntry,
  now: number,
): D1PreparedStatement {
  return env.IDENTITY_DB.prepare(
    `INSERT INTO org_audit (org_id, at, actor_id, actor_handle, action, target_id, target_handle, detail)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    entry.orgId,
    now,
    entry.actor.id,
    entry.actor.handle,
    entry.action,
    entry.target?.id ?? null,
    entry.target?.handle ?? null,
    entry.detail ?? '',
  );
}

/** Records one line on its own (for changes made in another database, like a transfer). */
export async function recordOrgAudit(
  env: IdentityEnv,
  entry: OrgAuditEntry,
  now: number,
): Promise<void> {
  await orgAuditStatement(env, entry, now).run();
}

/** The org's log, newest first. */
export async function listOrgAudit(
  env: IdentityEnv,
  orgId: string,
): Promise<readonly OrgAuditEvent[]> {
  const { results } = await env.IDENTITY_DB.prepare(
    `SELECT at, actor_handle, action, target_handle, detail FROM org_audit
     WHERE org_id = ? ORDER BY seq DESC LIMIT ?`,
  )
    .bind(orgId, LIST_LIMIT)
    .all<{
      at: number;
      actor_handle: string;
      action: string;
      target_handle: string | null;
      detail: string;
    }>();
  return results.map((row) => ({
    at: row.at,
    actorHandle: row.actor_handle,
    action: row.action,
    targetHandle: row.target_handle,
    detail: row.detail,
  }));
}
