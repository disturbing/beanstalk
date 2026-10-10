/**
 * The D1 indexes `repo-events` keeps (migration `0004_repo_events.sql`): activity lines, the
 * `beans` and `decisions` tables, `repo_daily` and `repo_lines`. Writes are idempotent (a
 * redelivered event is the same line, a state moves only on a newer engine seq, daily counts
 * are recomputed); reads are one D1 batch per page.
 */
import { z } from 'zod';

import type {
  IndexedBean,
  RepoDay,
  RepoEvent,
  RepoLines,
  RepositoryGrowth,
  RepositoryStalk,
  StalkPromotion,
} from '@gitstalk/shared-race/repo-events';
import { BEAN_STATES } from '@gitstalk/shared-race/repo-events';
import type { RepositoryActivity } from '@gitstalk/shared-race/repos';
import { ACTIVITY_KINDS } from '@gitstalk/shared-race/repos';

import { activityLine, dayOf } from './activity-text';

/** The repository the events belong to, as the registry has it. */
export type IndexedRepository = {
  readonly id: string;
  readonly ownerId: string;
  readonly engineId: string;
};

const COUNTED_KINDS = ['landed', 'promoted', 'reverted', 'red', 'rework', 'decision'] as const;
const BEANS_SHOWN = 200;
const PROMOTIONS_SHOWN = 20;
const ACTIVITY_SHOWN = 30;
/** Validation verdicts kept for History's commits (green, red, audit, revert). */
const VERDICTS_SHOWN = 100;
const DAYS_SHOWN = 7;

/** Writes one engine's events into the indexes, in one D1 batch (one transaction). */
export async function applyRepoEvents(
  db: D1Database,
  repo: IndexedRepository,
  events: readonly RepoEvent[],
): Promise<void> {
  if (events.length === 0) return;
  const normalized = events.map((event) => ({ ...event, at: isoOf(event.at) }));
  const days = [...new Set(normalized.map((event) => dayOf(event.at)))];
  const statements = [
    touchLines(db, repo.id, normalized[0]?.at ?? new Date().toISOString()),
    ...normalized.flatMap((event) => [
      activityInsert(db, repo, event),
      ...indexWrites(db, repo.id, event),
    ]),
    ...days.map((day) => dailyRecount(db, repo.id, day)),
  ];
  await db.batch(statements);
}

/** History's validation view of one repository (lines, verdicts, beans), in one round trip. */
export async function readStalk(db: D1Database, repoId: string): Promise<RepositoryStalk> {
  const [lines, beans, promotions, days, activity, verdicts] = await db.batch([
    db.prepare('SELECT * FROM repo_lines WHERE repo_id = ?').bind(repoId),
    db
      .prepare('SELECT * FROM beans WHERE repo_id = ? ORDER BY updated_at DESC, bean LIMIT ?')
      .bind(repoId, BEANS_SHOWN),
    db
      .prepare(
        `SELECT at, kind, text, sha FROM repository_activity
         WHERE repo_id = ? AND kind IN ('promoted', 'demoted') ORDER BY seq DESC LIMIT ?`,
      )
      .bind(repoId, PROMOTIONS_SHOWN),
    db
      .prepare('SELECT * FROM repo_daily WHERE repo_id = ? ORDER BY day DESC LIMIT ?')
      .bind(repoId, DAYS_SHOWN),
    activityQuery(db, 'a.repo_id = ?').bind(repoId, ACTIVITY_SHOWN),
    activityQuery(
      db,
      "a.repo_id = ? AND a.kind IN ('promoted', 'demoted', 'red', 'reverted') AND a.sha IS NOT NULL",
    ).bind(repoId, VERDICTS_SHOWN),
  ]);
  const indexed = (beans?.results ?? []).map(beanOf);
  return {
    lines: (lines?.results ?? []).map(linesOf)[0] ?? null,
    validating: indexed.filter((bean) => bean.state === 'landed'),
    promotions: (promotions?.results ?? []).map((row) => promotionOf(row, indexed)),
    off: indexed.filter((bean) => ['reverted', 'dropped', 'parked'].includes(bean.state)),
    growing: indexed.filter((bean) => bean.state === 'growing'),
    days: (days?.results ?? []).map((row) => DayRow.parse(row)),
    activity: (activity?.results ?? []).map(activityOf),
    verdicts: (verdicts?.results ?? []).map(activityOf),
  };
}

/** Bean counts for these repositories, and whether the index has heard from each. */
export async function readGrowth(
  db: D1Database,
  repoIds: readonly string[],
): Promise<RepositoryGrowth[]> {
  if (repoIds.length === 0) return [];
  const ids = JSON.stringify(repoIds);
  const [counts, lines] = await db.batch([
    db
      .prepare(
        `SELECT repo_id, SUM(state IN ('landed', 'promoted')) AS landed,
           SUM(state = 'growing') AS growing
         FROM beans WHERE repo_id IN (SELECT value FROM json_each(?)) GROUP BY repo_id`,
      )
      .bind(ids),
    db
      .prepare('SELECT repo_id FROM repo_lines WHERE repo_id IN (SELECT value FROM json_each(?))')
      .bind(ids),
  ]);
  const byRepo = new Map(
    (counts?.results ?? []).map((row) => [GrowthRow.parse(row).repo_id, GrowthRow.parse(row)]),
  );
  const heard = new Set(
    (lines?.results ?? []).map((row) => z.object({ repo_id: z.string() }).parse(row).repo_id),
  );
  return repoIds.map((repoId) => ({
    repo_id: repoId,
    landed: byRepo.get(repoId)?.landed ?? 0,
    growing: byRepo.get(repoId)?.growing ?? 0,
    indexed: heard.has(repoId),
  }));
}

/** Removes a deleted repository's index rows (with the registry's own, in its batch). */
export function indexDeletes(db: D1Database, repoId: string): D1PreparedStatement[] {
  return ['beans', 'decisions', 'repo_daily', 'repo_lines'].map((table) =>
    db.prepare(`DELETE FROM ${table} WHERE repo_id = ?`).bind(repoId),
  );
}

/** Activity rows joined with their repository's names; `where` binds before the limit. */
export function activityQuery(db: D1Database, where: string): D1PreparedStatement {
  return db.prepare(
    `SELECT a.repo_id, r.owner_handle, r.name AS repo_name, a.at, a.kind, a.text, a.bean, a.sha
     FROM repository_activity a JOIN repositories r ON r.id = a.repo_id
     WHERE ${where} ORDER BY a.seq DESC LIMIT ?`,
  );
}

const ActivityRow = z.object({
  repo_id: z.string(),
  owner_handle: z.string(),
  repo_name: z.string(),
  at: z.string(),
  kind: z.enum(ACTIVITY_KINDS),
  text: z.string(),
  bean: z.string().nullable().default(null),
  sha: z.string().nullable().default(null),
});

export function activityOf(row: unknown): RepositoryActivity {
  return ActivityRow.parse(row);
}

// Writes ----------------------------------------------------------------------------------

type Event = RepoEvent;

function activityInsert(
  db: D1Database,
  repo: IndexedRepository,
  event: Event,
): D1PreparedStatement {
  const line = activityLine(event);
  return db
    .prepare(
      `INSERT OR IGNORE INTO repository_activity
         (repo_id, owner_id, at, kind, text, event_key, bean, sha)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      repo.id,
      repo.ownerId,
      event.at,
      line.kind,
      line.text,
      `${repo.engineId}:${event.seq}`,
      line.bean,
      line.sha,
    );
}

function indexWrites(db: D1Database, repoId: string, event: Event): D1PreparedStatement[] {
  switch (event.kind) {
    case 'bean.opened':
      return [
        beanUpsert(db, repoId, event, {
          bean: event.bean,
          state: 'growing',
          title: event.title,
          actor: event.actor,
          opened_at: event.at,
        }),
      ];
    case 'bean.landed':
      return [
        beanUpsert(db, repoId, event, {
          bean: event.bean,
          state: 'landed',
          actor: event.actor,
          landed_at: event.at,
          landed_sha: event.sha,
          landed_idx: event.trunk_idx,
        }),
        sproutMove(db, repoId, event),
      ];
    case 'bean.rework':
      return [
        beanUpsert(db, repoId, event, { bean: event.bean, state: 'growing', reason: event.reason }),
        reworkRecount(db, repoId, event.bean),
      ];
    case 'bean.ended':
      return [
        beanUpsert(db, repoId, event, {
          bean: event.bean,
          state: event.outcome,
          reason: event.reason,
        }),
      ];
    case 'bean.reverted':
      return [
        ...(event.bean === null
          ? []
          : [
              beanUpsert(db, repoId, event, {
                bean: event.bean,
                state: 'reverted',
                reverted_at: event.at,
                reason: 'taken off the sprout after a red validation',
              }),
            ]),
        sproutMove(db, repoId, event),
      ];
    case 'stalk.promoted':
      return [
        ...event.beans.map((bean) =>
          beanUpsert(db, repoId, event, {
            bean,
            state: 'promoted',
            promoted_at: event.at,
            promoted_sha: event.sha,
          }),
        ),
        stalkMove(db, repoId, event),
      ];
    case 'stalk.demoted':
      return [
        ...event.beans.map((bean) =>
          beanUpsert(db, repoId, event, {
            bean,
            state: 'landed',
            reason: 'lands again after an audit',
          }),
        ),
        stalkMove(db, repoId, event),
      ];
    case 'sprout.red':
      return [];
    case 'decision.asked':
      return [decisionAsked(db, repoId, event)];
    case 'decision.made':
      return [decisionMade(db, repoId, event)];
    default:
      return [];
  }
}

type BeanFields = {
  readonly bean: string;
  readonly state: IndexedBean['state'];
  readonly title?: string;
  readonly actor?: string | null;
  readonly opened_at?: string;
  readonly landed_at?: string;
  readonly landed_sha?: string;
  readonly landed_idx?: number;
  readonly promoted_at?: string;
  readonly promoted_sha?: string;
  readonly reverted_at?: string;
  readonly reason?: string;
};

/**
 * One bean's row: the state (and its reason) only from a newer engine seq; first times
 * (opened, promoted) kept, the latest landing and revert kept, the title and pusher filled in.
 */
function beanUpsert(
  db: D1Database,
  repoId: string,
  event: Event,
  fields: BeanFields,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO beans (repo_id, bean, title, actor, state, state_seq, opened_at, landed_at,
         landed_sha, landed_idx, promoted_at, promoted_sha, reverted_at, reason, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (repo_id, bean) DO UPDATE SET
         title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE beans.title END,
         actor = COALESCE(excluded.actor, beans.actor),
         state = CASE WHEN excluded.state_seq > beans.state_seq THEN excluded.state ELSE beans.state END,
         reason = CASE WHEN excluded.state_seq > beans.state_seq THEN excluded.reason ELSE beans.reason END,
         state_seq = MAX(excluded.state_seq, beans.state_seq),
         opened_at = COALESCE(beans.opened_at, excluded.opened_at),
         landed_at = COALESCE(excluded.landed_at, beans.landed_at),
         landed_sha = COALESCE(excluded.landed_sha, beans.landed_sha),
         landed_idx = COALESCE(excluded.landed_idx, beans.landed_idx),
         promoted_at = COALESCE(beans.promoted_at, excluded.promoted_at),
         promoted_sha = COALESCE(beans.promoted_sha, excluded.promoted_sha),
         reverted_at = COALESCE(excluded.reverted_at, beans.reverted_at),
         updated_at = MAX(excluded.updated_at, beans.updated_at)`,
    )
    .bind(
      repoId,
      fields.bean,
      fields.title ?? '',
      fields.actor ?? null,
      fields.state,
      event.seq,
      fields.opened_at ?? null,
      fields.landed_at ?? null,
      fields.landed_sha ?? null,
      fields.landed_idx ?? null,
      fields.promoted_at ?? null,
      fields.promoted_sha ?? null,
      fields.reverted_at ?? null,
      fields.reason ?? '',
      event.at,
    );
}

function reworkRecount(db: D1Database, repoId: string, bean: string): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE beans SET reworks = (SELECT COUNT(*) FROM repository_activity
         WHERE repo_id = ?1 AND bean = ?2 AND kind = 'rework')
       WHERE repo_id = ?1 AND bean = ?2`,
    )
    .bind(repoId, bean);
}

function touchLines(db: D1Database, repoId: string, at: string): D1PreparedStatement {
  return db
    .prepare('INSERT OR IGNORE INTO repo_lines (repo_id, updated_at) VALUES (?, ?)')
    .bind(repoId, at);
}

type LineMove = {
  readonly seq: number;
  readonly at: string;
  readonly sha: string;
  readonly trunk_idx: number;
};

function sproutMove(db: D1Database, repoId: string, move: LineMove): D1PreparedStatement {
  return lineMove(db, repoId, move, 'sprout');
}

function stalkMove(db: D1Database, repoId: string, move: LineMove): D1PreparedStatement {
  return lineMove(db, repoId, move, 'stalk');
}

/** Moves one line's head, only for an event newer than the one that set it. */
function lineMove(
  db: D1Database,
  repoId: string,
  move: LineMove,
  line: 'sprout' | 'stalk',
): D1PreparedStatement {
  const newer = `excluded.${line}_seq > repo_lines.${line}_seq`;
  return db
    .prepare(
      `INSERT INTO repo_lines (repo_id, ${line}_sha, ${line}_idx, ${line}_seq, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (repo_id) DO UPDATE SET
         ${line}_sha = CASE WHEN ${newer} THEN excluded.${line}_sha ELSE repo_lines.${line}_sha END,
         ${line}_idx = CASE WHEN ${newer} THEN excluded.${line}_idx ELSE repo_lines.${line}_idx END,
         ${line}_seq = MAX(excluded.${line}_seq, repo_lines.${line}_seq),
         updated_at = MAX(excluded.updated_at, repo_lines.updated_at)`,
    )
    .bind(repoId, move.sha, move.trunk_idx, move.seq, move.at);
}

function decisionAsked(
  db: D1Database,
  repoId: string,
  event: Extract<Event, { kind: 'decision.asked' }>,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO decisions (repo_id, card, bean, against_json, reason, state, asked_at)
       VALUES (?, ?, ?, ?, ?, 'open', ?)
       ON CONFLICT (repo_id, card) DO UPDATE SET bean = excluded.bean,
         against_json = excluded.against_json, reason = excluded.reason,
         asked_at = excluded.asked_at`,
    )
    .bind(repoId, event.card, event.bean, JSON.stringify(event.against), event.reason, event.at);
}

function decisionMade(
  db: D1Database,
  repoId: string,
  event: Extract<Event, { kind: 'decision.made' }>,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO decisions (repo_id, card, state, winner, loser, decided_by, decided_at)
       VALUES (?, ?, 'decided', ?, ?, ?, ?)
       ON CONFLICT (repo_id, card) DO UPDATE SET state = 'decided', winner = excluded.winner,
         loser = excluded.loser, decided_by = excluded.decided_by, decided_at = excluded.decided_at`,
    )
    .bind(repoId, event.card, event.winner, event.loser, event.by, event.at);
}

/** Recounts one repository's day from its activity lines (idempotent under redelivery). */
function dailyRecount(db: D1Database, repoId: string, day: string): D1PreparedStatement {
  const next = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const kinds = COUNTED_KINDS.map((kind) => `'${kind}'`).join(', ');
  return db
    .prepare(
      `INSERT INTO repo_daily (repo_id, day, landed, promoted, reverted, red_validations, reworks, decisions)
       SELECT ?1, ?2, COALESCE(SUM(kind = 'landed'), 0), COALESCE(SUM(kind = 'promoted'), 0),
         COALESCE(SUM(kind = 'reverted'), 0), COALESCE(SUM(kind = 'red'), 0),
         COALESCE(SUM(kind = 'rework'), 0), COALESCE(SUM(kind = 'decision'), 0)
       FROM repository_activity
       WHERE repo_id = ?1 AND kind IN (${kinds}) AND at >= ?2 AND at < ?3
       ON CONFLICT (repo_id, day) DO UPDATE SET landed = excluded.landed,
         promoted = excluded.promoted, reverted = excluded.reverted,
         red_validations = excluded.red_validations, reworks = excluded.reworks,
         decisions = excluded.decisions`,
    )
    .bind(repoId, day, next);
}

/** The event's time as `toISOString` writes it (registry lines use the same form). */
function isoOf(at: string): string {
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? new Date().toISOString() : new Date(ms).toISOString();
}

// Reads -----------------------------------------------------------------------------------

const BeanRow = z.object({
  bean: z.string(),
  title: z.string(),
  actor: z.string().nullable(),
  state: z.enum(BEAN_STATES),
  opened_at: z.string().nullable(),
  landed_at: z.string().nullable(),
  landed_sha: z.string().nullable(),
  promoted_at: z.string().nullable(),
  promoted_sha: z.string().nullable(),
  reverted_at: z.string().nullable(),
  reason: z.string(),
  reworks: z.number().int(),
  updated_at: z.string(),
});

const LinesRow = z.object({
  sprout_sha: z.string().nullable(),
  sprout_idx: z.number().int().nullable(),
  stalk_sha: z.string().nullable(),
  stalk_idx: z.number().int().nullable(),
  updated_at: z.string(),
});

const DayRow = z.object({
  day: z.string(),
  landed: z.number().int(),
  promoted: z.number().int(),
  reverted: z.number().int(),
  red_validations: z.number().int(),
  reworks: z.number().int(),
  decisions: z.number().int(),
}) satisfies z.ZodType<RepoDay>;

const PromotionRow = z.object({
  at: z.string(),
  kind: z.enum(['promoted', 'demoted']),
  text: z.string(),
  sha: z.string(),
});

const GrowthRow = z.object({
  repo_id: z.string(),
  landed: z.number().int(),
  growing: z.number().int(),
});

function beanOf(row: unknown): IndexedBean {
  return BeanRow.parse(row);
}

function linesOf(row: unknown): RepoLines {
  return LinesRow.parse(row);
}

function promotionOf(row: unknown, beans: readonly IndexedBean[]): StalkPromotion {
  const promotion = PromotionRow.parse(row);
  return {
    ...promotion,
    beans:
      promotion.kind === 'promoted'
        ? beans.filter((bean) => bean.promoted_sha === promotion.sha)
        : [],
  };
}
