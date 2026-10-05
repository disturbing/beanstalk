/**
 * People and their agent sessions. A repository's contributors are people (owners) who
 * connect agent sessions (Claude Code, Codex …); the engine's slots (`a0` …) are sessions,
 * not standing agents. Recorded runs carry no owner data, so their adapter attributes every
 * session to a placeholder owner; real owners slot in through the same directory.
 */
import type { SlotId } from '@beanstalk/shared-race/ids';

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

function harnessName(agent: string): string {
  if (agent === 'claude') return 'Claude Code';
  if (agent === 'codex') return 'Codex';
  return agent === '' ? 'agent' : agent;
}
