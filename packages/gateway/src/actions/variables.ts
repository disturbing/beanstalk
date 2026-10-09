/**
 * Actions variables (`vars.*`, doc 25 §3.4): plain configuration at repository and org level,
 * stored as text and readable by anyone with a role. Org variables carry a repository access
 * policy like org secrets. A job gets every variable its repository sees (GitHub's rule), not
 * only the ones it names, and they are never masked.
 */
import { VariableName } from '@beanstalk/shared-race/actions-secrets';
import type {
  OrgVariableSummary,
  RepositoryAccessPolicy,
  VariableSummary,
} from '@beanstalk/shared-race/actions-secrets';
import { z } from 'zod';

import {
  AccessColumn,
  deleteSelected,
  policyOf,
  replaceSelected,
  selectedRepos,
} from './org-access-rows';

type By = { readonly actor: string; readonly at: string };

export type VariablesStore = {
  listRepo(repoId: string): Promise<VariableSummary[]>;
  putRepo(
    repoId: string,
    variable: { readonly name: VariableName; readonly value: string },
    by: By,
  ): Promise<VariableSummary>;
  deleteRepo(repoId: string, name: string): Promise<boolean>;
  listOrg(orgId: string): Promise<OrgVariableSummary[]>;
  putOrg(
    orgId: string,
    variable: {
      readonly name: VariableName;
      readonly value: string;
      readonly access: RepositoryAccessPolicy;
    },
    by: By,
  ): Promise<OrgVariableSummary>;
  deleteOrg(orgId: string, name: string): Promise<boolean>;
};

const Row = z.object({
  name: z.string(),
  value: z.string(),
  updated_at: z.string(),
  updated_by: z.string(),
});
const OrgRow = Row.extend({ access: AccessColumn });

export function d1Variables(db: D1Database): VariablesStore {
  return {
    async listRepo(repoId) {
      const { results } = await db
        .prepare(
          'SELECT name, value, updated_at, updated_by FROM actions_variables WHERE repo_id = ? ORDER BY name',
        )
        .bind(repoId)
        .all();
      return results.map((raw) => summaryOf(Row.parse(raw)));
    },
    async putRepo(repoId, variable, by) {
      await db
        .prepare(
          `INSERT INTO actions_variables (repo_id, name, value, updated_at, updated_by) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(repo_id, name) DO UPDATE SET value = excluded.value,
             updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(repoId, variable.name, variable.value, by.at, by.actor)
        .run();
      return { ...variable, updatedAt: by.at, updatedBy: by.actor };
    },
    async deleteRepo(repoId, name) {
      const result = await db
        .prepare('DELETE FROM actions_variables WHERE repo_id = ? AND name = ?')
        .bind(repoId, name.toUpperCase())
        .run();
      return result.meta.changes > 0;
    },
    async listOrg(orgId) {
      const [{ results }, selected] = await Promise.all([
        db
          .prepare(
            'SELECT name, value, access, updated_at, updated_by FROM actions_org_variables WHERE org_id = ? ORDER BY name',
          )
          .bind(orgId)
          .all(),
        selectedRepos(db, { orgId, kind: 'variable' }),
      ]);
      return results.map((raw) => {
        const row = OrgRow.parse(raw);
        return { ...summaryOf(row), access: policyOf(row.access, selected.get(row.name)) };
      });
    },
    async putOrg(orgId, variable, by) {
      const entry = { orgId, kind: 'variable', name: variable.name } as const;
      await db.batch([
        db
          .prepare(
            `INSERT INTO actions_org_variables (org_id, name, value, access, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(org_id, name) DO UPDATE SET value = excluded.value, access = excluded.access,
               updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
          )
          .bind(orgId, variable.name, variable.value, variable.access.kind, by.at, by.actor),
        ...replaceSelected(db, entry, variable.access),
      ]);
      return { ...variable, updatedAt: by.at, updatedBy: by.actor };
    },
    async deleteOrg(orgId, name) {
      const upper = name.toUpperCase();
      const [removed] = await db.batch([
        db
          .prepare('DELETE FROM actions_org_variables WHERE org_id = ? AND name = ?')
          .bind(orgId, upper),
        deleteSelected(db, { orgId, kind: 'variable', name: upper }),
      ]);
      return (removed?.meta.changes ?? 0) > 0;
    },
  };
}

function summaryOf(row: z.infer<typeof Row>): VariableSummary {
  return {
    name: VariableName.parse(row.name),
    value: row.value,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}
