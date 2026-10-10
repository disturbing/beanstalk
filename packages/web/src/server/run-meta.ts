/** A run's title for page headers: the recorded label, or the policy of a live run. */
import type { RunId } from '@gitstalk/shared-race/ids';

import type { RaceState } from '@gitstalk/shared-ask/race/race-state';
import { recordedRun } from '../recorded/recorded-runs';

export type RunMeta = { readonly label: string; readonly detail: string };

export function runMeta(run: RunId, state: RaceState): RunMeta {
  const recorded = recordedRun(run);
  const meta = state.meta;
  const policy = meta?.policy === 'queue' ? 'Merge queue' : 'Gitstalk v2';
  const agents =
    meta === null
      ? ''
      : `${meta.agents} ${meta.model ?? meta.agent} agents, ${meta.tasks.length} beans`;
  const source =
    recorded === undefined
      ? `live, ${state.phase === 'ended' ? 'finished' : 'racing'}`
      : 'recorded on Cloudflare';
  return {
    label: recorded?.label ?? policy,
    detail: [agents, source].filter((part) => part !== '').join('; '),
  };
}
