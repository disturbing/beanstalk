/**
 * The status line's "who": a race names the people and agent sessions at work now; a
 * repository names who pushed last (its beans come from people's pushes, not from slots).
 */
import type { Pushers, SessionDirectory } from '@gitstalk/shared-ask/home/sessions';
import { activeContributors, lastPush } from '@gitstalk/shared-ask/home/sessions';
import type { RaceState } from '@gitstalk/shared-ask/race/race-state';
import { plural } from '../race/race-format';

/** A race's contributors: people and agent sessions with a bean in flight. */
export function sessionsActiveLine(state: RaceState, sessions: SessionDirectory): string {
  const active = activeContributors(state, sessions);
  const people = `${active.people} ${active.people === 1 ? 'person' : 'people'}`;
  return `${people}, ${plural(active.sessions, 'session')} active`;
}

/** A repository's contributors: who pushed last, and how many people have pushed. */
export function lastPushLine(state: RaceState, pushers: Pushers): string {
  const last = lastPush(state, pushers);
  if (last === null) return 'no pushes yet';
  const others = last.people > 1 ? `, ${last.people} people pushing` : '';
  return `last push @${last.pusher}: ${last.bean}${others}`;
}
