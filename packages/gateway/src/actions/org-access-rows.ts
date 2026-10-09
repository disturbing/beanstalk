/**
 * The stored form of an org entry's repository access policy: the `access` column plus, for
 * `selected`, rows in `actions_org_entry_repos`. Shared by org secrets and org variables.
 */
import type { RepositoryAccessPolicy } from '@beanstalk/shared-race/actions-secrets';
import { z } from 'zod';

export type EntryKind = 'secret' | 'variable';

export const AccessColumn = z.enum(['all', 'private', 'selected']);

/** Selected repository ids per entry name, for one org and kind. */
export async function selectedRepos(
  db: D1Database,
  org: { readonly orgId: string; readonly kind: EntryKind },
): Promise<Map<string, string[]>> {
  const { results } = await db
    .prepare(
      'SELECT name, repo_id FROM actions_org_entry_repos WHERE org_id = ? AND kind = ? ORDER BY repo_id',
    )
    .bind(org.orgId, org.kind)
    .all();
  const byName = new Map<string, string[]>();
  for (const raw of results) {
    const row = z.object({ name: z.string(), repo_id: z.string() }).parse(raw);
    byName.set(row.name, [...(byName.get(row.name) ?? []), row.repo_id]);
  }
  return byName;
}

/** The policy a row and its selected list describe. */
export function policyOf(
  access: z.infer<typeof AccessColumn>,
  selected: readonly string[] | undefined,
): RepositoryAccessPolicy {
  return access === 'selected'
    ? { kind: 'selected', repoIds: [...(selected ?? [])] }
    : { kind: access };
}

/** Statements that replace an entry's selected list with the policy's (none unless selected). */
export function replaceSelected(
  db: D1Database,
  entry: { readonly orgId: string; readonly kind: EntryKind; readonly name: string },
  policy: RepositoryAccessPolicy,
): D1PreparedStatement[] {
  const clear = deleteSelected(db, entry);
  if (policy.kind !== 'selected') return [clear];
  const unique = [...new Set(policy.repoIds)];
  return [
    clear,
    ...unique.map((repoId) =>
      db
        .prepare(
          'INSERT INTO actions_org_entry_repos (org_id, kind, name, repo_id) VALUES (?, ?, ?, ?)',
        )
        .bind(entry.orgId, entry.kind, entry.name, repoId),
    ),
  ];
}

export function deleteSelected(
  db: D1Database,
  entry: { readonly orgId: string; readonly kind: EntryKind; readonly name: string },
): D1PreparedStatement {
  return db
    .prepare('DELETE FROM actions_org_entry_repos WHERE org_id = ? AND kind = ? AND name = ?')
    .bind(entry.orgId, entry.kind, entry.name);
}
