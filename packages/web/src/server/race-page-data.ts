/**
 * What the race canvas needs from the server: every event so far, the beans' titles, the
 * repo's files (so the code map is laid out once) and the engine's knobs no event states,
 * for a recorded or a live run.
 */
import type { RunId } from '@beanstalk/shared-race/ids';

import { allEvents } from '@beanstalk/shared-ask/ask/plan-context';
import type { ForgeSource } from '@beanstalk/shared-ask/forge/forge-source';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import type { RaceOptions } from '@beanstalk/shared-ask/race/race-state';
import { recordedRun } from '../recorded/recorded-runs';
import { titlesOf } from '../recorded/race-pair';

export type RacePageData = {
  readonly options: RaceOptions;
  readonly events: readonly RaceEvent[];
  readonly titles: Readonly<Record<string, string>>;
  readonly files: readonly string[];
};

export async function racePageData(source: ForgeSource, run: RunId): Promise<RacePageData> {
  const recorded = recordedRun(run);
  if (recorded !== undefined) {
    const [options, tree] = await Promise.all([
      source.runOptions(run),
      source.repoTree(run, 'sprout'),
    ]);
    return {
      options,
      events: recorded.events,
      titles: titlesOf(recorded),
      files: tree.files.map((file) => file.path),
    };
  }
  const [options, events, beans, files] = await Promise.all([
    source.runOptions(run),
    allEvents(source, run),
    source.beansByPath(run, []),
    source.repoTree(run, 'sprout').then(
      (tree) => tree.files.map((file) => file.path),
      // Early in a run the sprout may not be readable yet; the map then grows from the events.
      () => [],
    ),
  ]);
  return {
    options,
    events,
    titles: Object.fromEntries(beans.map((bean) => [bean.id, bean.title])),
    files,
  };
}
