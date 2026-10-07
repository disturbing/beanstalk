/**
 * What agents reserve and claim in a repository's engine, beside its pushed beans: a bean
 * name reserved with its intent before the first push (`bean_open`), and backlog tasks
 * claimed so two agents do not take the same one (`task_claim`). Both live in the engine's
 * SQLite, so a claim is decided in one place, one request at a time: two agents asking at
 * once get one yes and one no.
 *
 * Reservations and claims lapse (a day, two hours) so an agent that went away frees them.
 * A push of the reserved name by its holder consumes the reservation; a task's own beans
 * (`Task:` trailer, `-o task=`, or the reservation's task) say when it is in progress or done.
 */
import { z } from 'zod';

import type { BacklogTaskState } from '@beanstalk/shared-race/agent-repos';

import type { BeanPhase, PushBean } from '../push/push-bean';
import { listPushBeans, readPushBean } from '../push/push-bean';

/** A reserved name waits this long for its first push. */
export const RESERVATION_MS = 24 * 3600 * 1000;
/** A claim holds a task this long; claiming again (or opening a bean for it) renews it. */
export const CLAIM_MS = 2 * 3600 * 1000;

const IN_FLIGHT: ReadonlySet<BeanPhase> = new Set(['checking', 'waiting', 'red', 'conflict']);
const FINISHED: ReadonlySet<BeanPhase> = new Set(['landed', 'green']);

const Reservation = z.object({
  bean: z.string(),
  actor: z.string(),
  intent: z.string(),
  task: z.string().nullable(),
  reservedMs: z.number(),
  expiresMs: z.number(),
});
export type Reservation = z.infer<typeof Reservation>;

const Claim = z.object({
  task: z.string(),
  actor: z.string(),
  claimedMs: z.number(),
  expiresMs: z.number(),
});
export type Claim = z.infer<typeof Claim>;

export type Refusable<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: string };

/** Where a task stands in this engine (the backlog file's checkbox is read elsewhere). */
export type TaskStanding = {
  readonly state: BacklogTaskState;
  readonly by: string | null;
  readonly bean: string | null;
  readonly untilMs: number | null;
};

export function migrateAgentStore(sql: SqlStorage): void {
  sql.exec(
    'CREATE TABLE IF NOT EXISTS bean_reservations (bean TEXT PRIMARY KEY, body TEXT NOT NULL)',
  );
  sql.exec('CREATE TABLE IF NOT EXISTS task_claims (task TEXT PRIMARY KEY, body TEXT NOT NULL)');
}

/** The live reservation of `bean`, or null (a lapsed one is gone). */
export function readReservation(sql: SqlStorage, bean: string, nowMs: number): Reservation | null {
  const row = readRow(sql, 'bean_reservations', 'bean', bean);
  const parsed = Reservation.safeParse(row);
  return parsed.success && parsed.data.expiresMs > nowMs ? parsed.data : null;
}

export function dropReservation(sql: SqlStorage, bean: string): void {
  sql.exec('DELETE FROM bean_reservations WHERE bean = ?', bean);
}

/** Why `actor` may not push `bean` because someone else reserved it, or null. */
export function reservationRefusal(
  sql: SqlStorage,
  input: { readonly bean: string; readonly actor: string; readonly nowMs: number },
): string | null {
  const reservation = readReservation(sql, input.bean, input.nowMs);
  if (reservation === null || isSamePerson(reservation.actor, input.actor)) return null;
  return `bean ${input.bean} is reserved by @${reservation.actor} (bean_open); pick another name`;
}

/**
 * Reserves `bean` for `actor` with its intent, and claims its task. Refused when the name was
 * pushed already, someone else reserved it, or the task is someone else's.
 */
export function reserveBean(
  sql: SqlStorage,
  input: {
    readonly bean: string;
    readonly actor: string;
    readonly intent: string;
    readonly task: string | null;
    readonly nowMs: number;
  },
): Refusable<Reservation> {
  const pushed = readPushBean(sql, input.bean);
  if (pushed !== null) {
    return refuse(
      `bean ${input.bean} was pushed already (${pushed.phase}); a red or a conflict is reworked by pushing bean/${input.bean} again, new work takes a new name`,
    );
  }
  const refusal = reservationRefusal(sql, input);
  if (refusal !== null) return refuse(refusal);
  if (input.task !== null) {
    const claimed = claimTask(sql, { task: input.task, actor: input.actor, nowMs: input.nowMs });
    if (!claimed.ok) return claimed;
  }
  const reservation: Reservation = {
    bean: input.bean,
    actor: input.actor,
    intent: input.intent,
    task: input.task,
    reservedMs: input.nowMs,
    expiresMs: input.nowMs + RESERVATION_MS,
  };
  writeRow(sql, 'bean_reservations', 'bean', reservation.bean, reservation);
  return { ok: true, value: reservation };
}

/** Claims `task` for `actor` (renewing their own claim); refused while it is someone else's. */
export function claimTask(
  sql: SqlStorage,
  input: { readonly task: string; readonly actor: string; readonly nowMs: number },
): Refusable<TaskStanding> {
  const standing = taskStanding(sql, input.task, input.nowMs);
  if (standing.state === 'done')
    return refuse(`task ${input.task} is done: bean ${standing.bean ?? '?'} landed`);
  if (standing.by !== null && !isSamePerson(standing.by, input.actor)) {
    const what =
      standing.bean === null
        ? `claimed by @${standing.by} until ${iso(standing.untilMs)}`
        : `in progress: @${standing.by}'s bean ${standing.bean}`;
    return refuse(`task ${input.task} is ${what}; pick another task`);
  }
  const claim: Claim = {
    task: input.task,
    actor: input.actor,
    claimedMs: input.nowMs,
    expiresMs: input.nowMs + CLAIM_MS,
  };
  writeRow(sql, 'task_claims', 'task', claim.task, claim);
  return { ok: true, value: taskStanding(sql, input.task, input.nowMs) };
}

/**
 * Gives a task back: drops `actor`'s claim and the names they reserved for it (not their
 * pushed beans: a bean out for the task still holds it). Refused while someone else holds it.
 */
export function releaseTask(
  sql: SqlStorage,
  input: { readonly task: string; readonly actor: string; readonly nowMs: number },
): Refusable<TaskStanding> {
  const claim = Claim.safeParse(readRow(sql, 'task_claims', 'task', input.task));
  const isOthers =
    claim.success &&
    claim.data.expiresMs > input.nowMs &&
    !isSamePerson(claim.data.actor, input.actor);
  if (isOthers) return refuse(`task ${input.task} is claimed by @${claim.data.actor}, not you`);
  sql.exec('DELETE FROM task_claims WHERE task = ?', input.task);
  for (const reservation of liveReservations(sql, input.nowMs)) {
    if (reservation.task === input.task && isSamePerson(reservation.actor, input.actor))
      dropReservation(sql, reservation.bean);
  }
  return { ok: true, value: taskStanding(sql, input.task, input.nowMs) };
}

/** Where each task stands: done by a landed bean, in progress, claimed, or open. */
export function taskStandings(
  sql: SqlStorage,
  tasks: readonly string[],
  nowMs: number,
): Readonly<Record<string, TaskStanding>> {
  const pushed = listPushBeans(sql);
  return Object.fromEntries(
    tasks.map((task) => [task, standingOf(sql, { task, nowMs, pushed })] as const),
  );
}

function taskStanding(sql: SqlStorage, task: string, nowMs: number): TaskStanding {
  return standingOf(sql, { task, nowMs, pushed: listPushBeans(sql) });
}

function standingOf(
  sql: SqlStorage,
  input: { readonly task: string; readonly nowMs: number; readonly pushed: readonly PushBean[] },
): TaskStanding {
  const beans = input.pushed.filter((bean) => bean.task === input.task);
  const finished = beans.find((bean) => FINISHED.has(bean.phase));
  if (finished !== undefined)
    return { state: 'done', by: finished.actor, bean: finished.bean, untilMs: null };
  const working = beans.find((bean) => IN_FLIGHT.has(bean.phase));
  if (working !== undefined)
    return { state: 'in_progress', by: working.actor, bean: working.bean, untilMs: null };
  const reserved = liveReservations(sql, input.nowMs).find(
    (reservation) => reservation.task === input.task,
  );
  if (reserved !== undefined)
    return {
      state: 'in_progress',
      by: reserved.actor,
      bean: reserved.bean,
      untilMs: reserved.expiresMs,
    };
  const claim = Claim.safeParse(readRow(sql, 'task_claims', 'task', input.task));
  if (claim.success && claim.data.expiresMs > input.nowMs)
    return { state: 'claimed', by: claim.data.actor, bean: null, untilMs: claim.data.expiresMs };
  return { state: 'open', by: null, bean: null, untilMs: null };
}

function liveReservations(sql: SqlStorage, nowMs: number): Reservation[] {
  return sql
    .exec<{ body: string }>('SELECT body FROM bean_reservations')
    .toArray()
    .flatMap((row) => {
      const parsed = Reservation.safeParse(JSON.parse(row.body));
      return parsed.success && parsed.data.expiresMs > nowMs ? [parsed.data] : [];
    });
}

type Table = 'bean_reservations' | 'task_claims';

function readRow(sql: SqlStorage, table: Table, key: string, value: string): unknown {
  const row = sql
    .exec<{ body: string }>(`SELECT body FROM ${table} WHERE ${key} = ?`, value)
    .toArray()[0];
  return row === undefined ? null : JSON.parse(row.body);
}

function writeRow(sql: SqlStorage, table: Table, key: string, value: string, body: object): void {
  sql.exec(
    `INSERT INTO ${table} (${key}, body) VALUES (?, ?) ON CONFLICT(${key}) DO UPDATE SET body = excluded.body`,
    value,
    JSON.stringify(body),
  );
}

/** Handles compare without case (sign-up lowercases them; git tokens may not). */
function isSamePerson(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function iso(ms: number | null): string {
  return ms === null ? 'later' : new Date(ms).toISOString();
}

function refuse(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}
