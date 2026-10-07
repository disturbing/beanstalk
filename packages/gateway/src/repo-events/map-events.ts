/**
 * From an engine's event log to repository events (`@beanstalk/shared-race/repo-events`): the
 * few event types the forge's indexes care about, each read with its own schema (the log is
 * stored JSON, so it is validated like any other boundary). Everything else is skipped.
 */
import { z } from 'zod';

import type { RepoEvent } from '@beanstalk/shared-race/repo-events';

/** Who pushed a bean and what it is called, from the push driver's records. */
export type BeanFacts = { readonly title: string; readonly actor: string | null };
export type BeanLookup = (bean: string) => BeanFacts | null;

/** A row of the engine's `events` table. */
export type StoredEvent = { readonly seq: number; readonly body: string };

/** Lists in a message are capped (the schema allows 50). */
const MAX_LIST = 50;
const MAX_TEXT = 500;
const MAX_NAME = 200;

const Envelope = z.object({ seq: z.number().int(), ts: z.string(), type: z.string() });
const Strings = z.array(z.string()).catch([]);

const TaskStart = z.object({ task: z.string() });
const Land = z.object({
  task: z.string().nullable(),
  kind: z.string().default('task'),
  sha: z.string(),
  trunk_idx: z.number().int().default(0),
  files: Strings,
});
const Rework = z.object({ task: z.string().nullable(), reason: z.string().default('') });
const Ended = z.object({ task: z.string(), reason: z.string().default('') });
const Revert = z.object({
  task: z.string().nullable(),
  reverted: z.string(),
  sha: z.string(),
  trunk_idx: z.number().int(),
});
const Promote = z.object({
  sha: z.string(),
  trunk_idx: z.number().int().default(0),
  tasks: Strings,
});
const Demote = z.object({
  sha: z.string(),
  trunk_idx: z.number().int(),
  tasks: Strings,
  failing: Strings,
});
const TicketOpen = z.object({ red_sha: z.string(), red_idx: z.number().int(), failing: Strings });
const DecisionRequest = z.object({
  card: z.string(),
  task: z.string(),
  against: Strings,
  reason: z.string().optional(),
});
const DecisionMade = z.object({
  card: z.string(),
  winner: z.string(),
  loser: z.string(),
  oracle: z.string(),
});

/** The engine event types that become repository events. */
export const PUBLISHED_TYPES: readonly string[] = [
  'task.start',
  'land',
  'rework.start',
  'task.drop',
  'task.parked',
  'revert',
  'green.promote',
  'green.demote',
  'ticket.open',
  'decision.request',
  'decision.made',
];

/** The repository events of these stored engine events, in order; unknown or bad rows skipped. */
export function repoEventsOf(rows: readonly StoredEvent[], lookup: BeanLookup): RepoEvent[] {
  return rows.flatMap((row) => {
    const event = parseRow(row.body);
    if (event === null) return [];
    const mapped = mapEvent(event, { seq: row.seq, at: event.ts }, lookup);
    return mapped === null ? [] : [mapped];
  });
}

type Parsed = z.infer<typeof Envelope> & { readonly raw: unknown };
type At = { readonly seq: number; readonly at: string };

function parseRow(body: string): Parsed | null {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return null;
  }
  const envelope = Envelope.safeParse(raw);
  return envelope.success ? { ...envelope.data, raw } : null;
}

function mapEvent(event: Parsed, at: At, lookup: BeanLookup): RepoEvent | null {
  switch (event.type) {
    case 'task.start':
      return opened(event.raw, at, lookup);
    case 'land':
      return landed(event.raw, at, lookup);
    case 'rework.start':
      return rework(event.raw, at);
    case 'task.drop':
    case 'task.parked':
      return ended(event.raw, at, event.type === 'task.drop' ? 'dropped' : 'parked');
    case 'revert':
      return reverted(event.raw, at);
    case 'green.promote':
      return promoted(event.raw, at);
    case 'green.demote':
      return demoted(event.raw, at);
    case 'ticket.open':
      return red(event.raw, at);
    case 'decision.request':
      return asked(event.raw, at);
    case 'decision.made':
      return decided(event.raw, at);
    default:
      return null;
  }
}

function opened(raw: unknown, at: At, lookup: BeanLookup): RepoEvent | null {
  const parsed = TaskStart.safeParse(raw);
  if (!parsed.success) return null;
  const facts = lookup(parsed.data.task);
  return {
    ...at,
    kind: 'bean.opened',
    bean: parsed.data.task,
    title: cut(facts?.title ?? ''),
    actor: facts?.actor ?? null,
  };
}

function landed(raw: unknown, at: At, lookup: BeanLookup): RepoEvent | null {
  const parsed = Land.safeParse(raw);
  // A ticket's fix or a revert lands too; only a bean's own landing is a bean event.
  if (!parsed.success || parsed.data.task === null || parsed.data.kind !== 'task') return null;
  const { task, sha, trunk_idx, files } = parsed.data;
  return {
    ...at,
    kind: 'bean.landed',
    bean: task,
    sha,
    trunk_idx,
    files: files.length,
    actor: lookup(task)?.actor ?? null,
  };
}

function rework(raw: unknown, at: At): RepoEvent | null {
  const parsed = Rework.safeParse(raw);
  if (!parsed.success || parsed.data.task === null) return null;
  return { ...at, kind: 'bean.rework', bean: parsed.data.task, reason: cut(parsed.data.reason) };
}

function ended(raw: unknown, at: At, outcome: 'dropped' | 'parked'): RepoEvent | null {
  const parsed = Ended.safeParse(raw);
  if (!parsed.success) return null;
  const { task, reason } = parsed.data;
  return { ...at, kind: 'bean.ended', bean: task, outcome, reason: cut(reason) };
}

function reverted(raw: unknown, at: At): RepoEvent | null {
  const parsed = Revert.safeParse(raw);
  if (!parsed.success) return null;
  const { task, reverted: revertedSha, sha, trunk_idx } = parsed.data;
  return { ...at, kind: 'bean.reverted', bean: task, reverted: revertedSha, sha, trunk_idx };
}

function promoted(raw: unknown, at: At): RepoEvent | null {
  const parsed = Promote.safeParse(raw);
  if (!parsed.success) return null;
  const { sha, trunk_idx, tasks } = parsed.data;
  return { ...at, kind: 'stalk.promoted', sha, trunk_idx, beans: names(tasks) };
}

function demoted(raw: unknown, at: At): RepoEvent | null {
  const parsed = Demote.safeParse(raw);
  if (!parsed.success) return null;
  const { sha, trunk_idx, tasks, failing } = parsed.data;
  return {
    ...at,
    kind: 'stalk.demoted',
    sha,
    trunk_idx,
    beans: names(tasks),
    failing: names(failing),
  };
}

function red(raw: unknown, at: At): RepoEvent | null {
  const parsed = TicketOpen.safeParse(raw);
  if (!parsed.success) return null;
  const { red_sha, red_idx, failing } = parsed.data;
  return {
    ...at,
    kind: 'sprout.red',
    sha: red_sha,
    trunk_idx: red_idx,
    failing: names(failing),
  };
}

function asked(raw: unknown, at: At): RepoEvent | null {
  const parsed = DecisionRequest.safeParse(raw);
  if (!parsed.success) return null;
  const { card, task, against, reason } = parsed.data;
  return {
    ...at,
    kind: 'decision.asked',
    card,
    bean: task,
    against: names(against),
    reason: reason === undefined ? null : cut(reason),
  };
}

function decided(raw: unknown, at: At): RepoEvent | null {
  const parsed = DecisionMade.safeParse(raw);
  if (!parsed.success) return null;
  const { card, winner, loser, oracle } = parsed.data;
  return { ...at, kind: 'decision.made', card, winner, loser, by: oracle };
}

/** A list as a message carries it: at most 50 entries of at most 200 characters. */
function names(list: readonly string[]): string[] {
  return list.slice(0, MAX_LIST).map((name) => name.slice(0, MAX_NAME));
}

function cut(text: string): string {
  return text.length <= MAX_TEXT ? text : `${text.slice(0, MAX_TEXT - 1)}…`;
}
