/**
 * The repository registry in D1 (`migrations/0001_repositories.sql`): records, the per-owner
 * name uniqueness (a unique index on the lower-cased name) and each repository's own history.
 * D1 rather than a Durable Object because every read here is a cross-repository index (an
 * owner's list, a handle and name lookup, activity across repositories) and the uniqueness
 * is one index; the engine's hot state stays in its own Durable Object.
 */
import { assertNever } from '../engine/errors';
import { z } from 'zod';

import type {
  RepoOrigin,
  RepoOwner,
  RepoVisibility,
  RepositoryActivity,
  RepositoryRecord,
} from '@beanstalk/shared-race/repos';

/** What creating a record needs; the registry stamps the times. */
export type NewRepository = {
  readonly id: string;
  readonly owner: RepoOwner;
  readonly name: string;
  readonly description: string;
  readonly visibility: RepoVisibility;
  readonly origin: RepoOrigin;
  readonly artifactsRepo: string;
  readonly engineId: string;
};

export type RegistryPatch = {
  readonly name?: string | undefined;
  readonly description?: string | undefined;
  readonly visibility?: RepoVisibility | undefined;
};

export type Registry = {
  /** Reserves the name; false when the owner already has a repository by that name. */
  reserve(repo: NewRepository, nowMs: number): Promise<boolean>;
  /** Marks a reserved repository ready, with its engine, and records its creation. */
  markReady(id: string, engineId: string, nowMs: number): Promise<RepositoryRecord | null>;
  byId(id: string): Promise<RepositoryRecord | null>;
  byName(ownerHandle: string, name: string): Promise<RepositoryRecord | null>;
  byOwner(ownerId: string): Promise<readonly RepositoryRecord[]>;
  /** Applies the patch; 'taken' when a rename collides, null when the repository is missing. */
  update(
    id: string,
    patch: RegistryPatch,
    nowMs: number,
  ): Promise<RepositoryRecord | 'taken' | null>;
  remove(id: string): Promise<void>;
  activity(ownerId: string, limit: number): Promise<readonly RepositoryActivity[]>;
};

const MAX_ACTIVITY = 100;

const Row = z.object({
  id: z.string(),
  owner_id: z.string(),
  owner_handle: z.string(),
  name: z.string(),
  description: z.string(),
  visibility: z.enum(['public', 'private']),
  origin_json: z.string(),
  artifacts_repo: z.string(),
  engine_id: z.string(),
  default_branch: z.string(),
  state: z.enum(['provisioning', 'ready']),
  created_at: z.string(),
  updated_at: z.string(),
});

const Origin = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }),
  z.object({ kind: z.literal('template'), template: z.enum(['typescript-starter']) }),
  z.object({ kind: z.literal('import'), url: z.string() }),
]);

const ActivityRow = z.object({
  repo_id: z.string(),
  owner_handle: z.string(),
  repo_name: z.string(),
  at: z.string(),
  kind: z.enum(['created', 'renamed', 'described', 'visibility']),
  text: z.string(),
});

const SELECT = 'SELECT * FROM repositories';

export function d1Registry(db: D1Database): Registry {
  const one = async (sql: string, ...values: unknown[]): Promise<RepositoryRecord | null> => {
    const row = await db
      .prepare(sql)
      .bind(...values)
      .first();
    return row === null ? null : recordOf(row);
  };
  return {
    async reserve(repo, nowMs) {
      const at = iso(nowMs);
      try {
        await db
          .prepare(
            `INSERT INTO repositories (id, owner_id, owner_handle, name, name_key, description,
               visibility, origin_json, artifacts_repo, engine_id, state, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'provisioning', ?, ?)`,
          )
          .bind(
            repo.id,
            repo.owner.id,
            repo.owner.handle,
            repo.name,
            repo.name.toLowerCase(),
            repo.description,
            repo.visibility,
            JSON.stringify(repo.origin),
            repo.artifactsRepo,
            repo.engineId,
            at,
            at,
          )
          .run();
        return true;
      } catch (error: unknown) {
        if (isUniqueViolation(error)) return false;
        throw error;
      }
    },
    async markReady(id, engineId, nowMs) {
      const record = await one(`${SELECT} WHERE id = ?`, id);
      if (record === null) return null;
      const at = iso(nowMs);
      await db.batch([
        db
          .prepare(
            `UPDATE repositories SET state = 'ready', engine_id = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(engineId, at, id),
        activityInsert(db, record, at, 'created', createdText(record.origin)),
      ]);
      return { ...record, engine_id: engineId, updated_at: at };
    },
    byId: (id) => one(`${SELECT} WHERE id = ? AND state = 'ready'`, id),
    byName: (ownerHandle, name) =>
      one(
        `${SELECT} WHERE owner_handle = ? AND name_key = ? AND state = 'ready'`,
        ownerHandle,
        name.toLowerCase(),
      ),
    async byOwner(ownerId) {
      const { results } = await db
        .prepare(`${SELECT} WHERE owner_id = ? AND state = 'ready' ORDER BY created_at DESC, id`)
        .bind(ownerId)
        .all();
      return results.map(recordOf);
    },
    async update(id, patch, nowMs) {
      const before = await one(`${SELECT} WHERE id = ? AND state = 'ready'`, id);
      if (before === null) return null;
      const after: RepositoryRecord = {
        ...before,
        name: patch.name ?? before.name,
        description: patch.description ?? before.description,
        visibility: patch.visibility ?? before.visibility,
        updated_at: iso(nowMs),
      };
      try {
        await db.batch([
          db
            .prepare(
              `UPDATE repositories SET name = ?, name_key = ?, description = ?, visibility = ?,
                 updated_at = ? WHERE id = ?`,
            )
            .bind(
              after.name,
              after.name.toLowerCase(),
              after.description,
              after.visibility,
              after.updated_at,
              id,
            ),
          ...changes(before, after).map((change) =>
            activityInsert(db, after, after.updated_at, change.kind, change.text),
          ),
        ]);
      } catch (error: unknown) {
        if (isUniqueViolation(error)) return 'taken';
        throw error;
      }
      return after;
    },
    async remove(id) {
      await db.batch([
        db.prepare('DELETE FROM repository_activity WHERE repo_id = ?').bind(id),
        db.prepare('DELETE FROM repositories WHERE id = ?').bind(id),
      ]);
    },
    async activity(ownerId, limit) {
      const { results } = await db
        .prepare(
          `SELECT a.repo_id, r.owner_handle, r.name AS repo_name, a.at, a.kind, a.text
           FROM repository_activity a JOIN repositories r ON r.id = a.repo_id
           WHERE a.owner_id = ? ORDER BY a.seq DESC LIMIT ?`,
        )
        .bind(ownerId, Math.max(1, Math.min(MAX_ACTIVITY, Math.trunc(limit))))
        .all();
      return results.map((row) => ActivityRow.parse(row));
    },
  };
}

function recordOf(row: unknown): RepositoryRecord {
  const parsed = Row.parse(row);
  return {
    id: parsed.id,
    owner: { id: parsed.owner_id, handle: parsed.owner_handle },
    name: parsed.name,
    description: parsed.description,
    visibility: parsed.visibility,
    origin: Origin.parse(JSON.parse(parsed.origin_json)),
    artifacts_repo: parsed.artifacts_repo,
    engine_id: parsed.engine_id,
    default_branch: parsed.default_branch,
    created_at: parsed.created_at,
    updated_at: parsed.updated_at,
  };
}

type Change = { readonly kind: RepositoryActivity['kind']; readonly text: string };

function changes(before: RepositoryRecord, after: RepositoryRecord): Change[] {
  const out: Change[] = [];
  if (before.name !== after.name)
    out.push({ kind: 'renamed', text: `Renamed from ${before.name}.` });
  if (before.description !== after.description)
    out.push({ kind: 'described', text: 'Description changed.' });
  if (before.visibility !== after.visibility)
    out.push({ kind: 'visibility', text: `Made ${after.visibility}.` });
  return out;
}

function createdText(origin: RepoOrigin): string {
  switch (origin.kind) {
    case 'empty':
      return 'Created with a README.';
    case 'template':
      return 'Created from the TypeScript starter.';
    case 'import':
      return `Imported from ${origin.url}.`;
    default:
      return assertNever(origin);
  }
}

function activityInsert(
  db: D1Database,
  record: RepositoryRecord,
  at: string,
  kind: RepositoryActivity['kind'],
  text: string,
): D1PreparedStatement {
  return db
    .prepare(
      'INSERT INTO repository_activity (repo_id, owner_id, at, kind, text) VALUES (?, ?, ?, ?, ?)',
    )
    .bind(record.id, record.owner.id, at, kind, text);
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}
