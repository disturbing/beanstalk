/**
 * People and their agent sessions. A repository's contributors are people (owners) who
 * connect agent sessions (Claude Code, Codex …); the engine's slots (`a0` …) are sessions,
 * not standing agents. Recorded runs carry no owner data, so their adapter attributes every
 * session to a placeholder owner; real owners slot in through the same directory.
 */
import type { SlotId } from '@gitstalk/shared-race/ids';

import { isInFlight } from '../race/race-counters';
import type { RaceState } from '../race/race-state';

export type Session = {
  readonly slot: string;
  /** The person who connected the session. */
  readonly owner: string;
  /** The harness the session runs: `Claude Code`, `Codex` … */
  readonly harness: string;
};

/** Sessions by slot, as the page receives them (plain data, so it crosses to the client). */
export type SessionDirectory = Readonly<Record<string, Session>>;

/** Every slot of a run attributed to one owner: the recorded runs' placeholder. */
export function placeholderSessions(state: RaceState, owner: string): SessionDirectory {
  const slots = state.lanes.map((lane) => lane.slot);
  const harness = harnessName(state.meta?.agent ?? '');
  return Object.fromEntries(slots.map((slot) => [slot, { slot, owner, harness }]));
}

export type ActiveContributors = { readonly people: number; readonly sessions: number };

/** People and sessions with a bean in flight now. */
export function activeContributors(
  state: RaceState,
  directory: SessionDirectory,
): ActiveContributors {
  const busy = new Set<SlotId>();
  for (const bean of Object.values(state.beans)) {
    if (isInFlight(bean.phase) && bean.startedAt !== null && bean.agent !== null)
      busy.add(bean.agent);
  }
  const people = new Set([...busy].map((slot) => directory[slot]?.owner ?? 'unknown'));
  return { people: people.size, sessions: busy.size };
}

/**
 * Who pushed each bean of a persistent repository, by bean id (a pushed bean's id is its
 * name): the handle the gateway records for the push. Empty for races, whose beans come
 * from agent sessions.
 */
export type Pushers = Readonly<Record<string, string>>;

/**
 * Who grew a bean, as a page names them: a short label (`@coop`, `a0`) and a longer
 * description (empty when nothing more is known).
 */
export type Credit = {
  readonly kind: 'pusher' | 'session' | 'slot';
  readonly who: string;
  readonly detail: string;
};

/** A pushed bean's person, else the slot's session (races), else the bare slot. */
export function creditOf(
  bean: { readonly id: string; readonly agent: string | null },
  directory: SessionDirectory,
  pushers: Pushers,
): Credit {
  const pusher = pushers[bean.id];
  if (pusher !== undefined)
    return { kind: 'pusher', who: `@${pusher}`, detail: `pushed by @${pusher}` };
  const session = bean.agent === null ? undefined : directory[bean.agent];
  if (session === undefined) return { kind: 'slot', who: bean.agent ?? '', detail: '' };
  return {
    kind: 'session',
    who: bean.agent ?? '',
    detail: `${session.harness} session of ${session.owner}`,
  };
}

export type LastPush = {
  readonly pusher: string;
  readonly bean: string;
  /** Distinct people who pushed a bean so far. */
  readonly people: number;
};

/** The newest pushed bean that has started, and who pushed it; null before the first push. */
export function lastPush(state: RaceState, pushers: Pushers): LastPush | null {
  const pushed = Object.values(state.beans).filter(
    (bean) => pushers[bean.id] !== undefined && bean.startedAt !== null,
  );
  const newest = pushed.toSorted((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
  const pusher = newest === undefined ? undefined : pushers[newest.id];
  if (newest === undefined || pusher === undefined) return null;
  const people = new Set(pushed.flatMap((bean) => pushers[bean.id] ?? [])).size;
  return { pusher, bean: newest.id, people };
}

function harnessName(agent: string): string {
  if (agent === 'claude') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  return agent === '' ? 'agent' : agent;
}
