/**
 * Who each agent session belongs to. Runs carry no owner data yet (sessions connect through
 * the plugin without an owner identity), so every session of a run is attributed to the
 * repository's owner. When the gateway reports session owners, this is the one place to read
 * them (`docs/claude-opus/14` §11).
 */
import type { RunId } from '@gitstalk/shared-race/ids';

import type { SessionDirectory } from '@gitstalk/shared-ask/home/sessions';
import { placeholderSessions } from '@gitstalk/shared-ask/home/sessions';
import type { RaceState } from '@gitstalk/shared-ask/race/race-state';
import { repositoryOf } from './repository';

export function sessionsFor(run: RunId, state: RaceState, owner?: string): SessionDirectory {
  return placeholderSessions(state, owner ?? repositoryOf(run).owner);
}
