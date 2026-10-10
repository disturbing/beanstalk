/**
 * Who did it, and the audit lines Actions settings changes write: repository secrets and
 * variables to `repository_audit` (the repository's access log), org secrets and variables to
 * `actions_org_audit`. Names and policies only, never values.
 */
import type {
  OrgActionsAuditAction,
  OrgActionsAuditEntry,
} from '@gitstalk/shared-race/actions-secrets';
import type {
  RepositoryAuditAction,
  RepositoryForViewer,
} from '@gitstalk/shared-race/collaborators';
import type { Viewer } from '@gitstalk/shared-race/repos';
import { z } from 'zod';

/** Org audit lines shown in Settings. */
const ORG_AUDIT_LIMIT = 50;

/** The signed-in person's handle (for `actor` and `updatedBy`). */
export async function handleOf(env: Env, viewer: Viewer): Promise<string> {
  if (viewer === null) return 'anonymous';
  const row = await env.IDENTITY_DB.prepare('SELECT handle FROM users WHERE id = ?')
    .bind(viewer)
    .first<{ handle: string }>();
  return row?.handle ?? viewer;
}

/** Records a change to a repository's secrets or variables in its access log. */
export async function auditRepository(
  db: D1Database,
  entry: {
    readonly repo: RepositoryForViewer;
    readonly viewer: Viewer;
    readonly actor: string;
    readonly action: RepositoryAuditAction;
    readonly detail: string;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO repository_audit (repo_id, at, actor_id, actor_handle, action, detail) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      entry.repo.id,
      new Date().toISOString(),
      entry.viewer ?? '',
      entry.actor,
      entry.action,
      entry.detail,
    )
    .run();
}

/** Records a change to an org's secrets or variables. */
export async function auditOrg(
  db: D1Database,
  entry: {
    readonly orgId: string;
    readonly viewer: Viewer;
    readonly actor: string;
    readonly action: OrgActionsAuditAction;
    readonly detail: string;
  },
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO actions_org_audit (org_id, at, actor_id, actor_handle, action, detail) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(
      entry.orgId,
      new Date().toISOString(),
      entry.viewer ?? '',
      entry.actor,
      entry.action,
      entry.detail,
    )
    .run();
}

const OrgAuditRow = z.object({
  at: z.string(),
  actor_handle: z.string(),
  action: z.enum([
    'org-secret-set',
    'org-secret-deleted',
    'org-variable-set',
    'org-variable-deleted',
  ]),
  detail: z.string(),
});

/** The org's latest Actions settings changes, newest first. */
export async function orgAuditLog(db: D1Database, orgId: string): Promise<OrgActionsAuditEntry[]> {
  const { results } = await db
    .prepare(
      'SELECT at, actor_handle, action, detail FROM actions_org_audit WHERE org_id = ? ORDER BY at DESC LIMIT ?',
    )
    .bind(orgId, ORG_AUDIT_LIMIT)
    .all();
  return results.map((raw) => {
    const row = OrgAuditRow.parse(raw);
    return { at: row.at, actorHandle: row.actor_handle, action: row.action, detail: row.detail };
  });
}
