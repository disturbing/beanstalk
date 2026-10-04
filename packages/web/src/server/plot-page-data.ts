/**
 * What the Plot needs from the server: every event so far (the client reduces them at the
 * playhead), the beans' titles, the repository's areas and each landing's per-file line
 * counts, for a recorded or a live run.
 */
import type { RunId } from '@beanstalk/shared-race/ids';

import { allEvents } from '@beanstalk/shared-ask/ask/plan-context';
import type { ForgeSource } from '@beanstalk/shared-ask/forge/forge-source';
import { bedsOf } from '@beanstalk/shared-ask/plot/plot-model';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import type { RaceOptions } from '@beanstalk/shared-ask/race/race-state';
import type { FileStat } from '@beanstalk/shared-ask/repo/repo-types';
import { titlesOf } from '../recorded/race-pair';
import { recordedRun } from '../recorded/recorded-runs';

export type PlotPageData = {
  readonly options: RaceOptions;
  readonly events: readonly RaceEvent[];
  readonly titles: Readonly<Record<string, string>>;
  readonly beds: readonly string[];
  /** Per-file line counts of each line commit, by sha. */
  readonly stats: Readonly<Record<string, readonly FileStat[]>>;
};

export async function plotPageData(source: ForgeSource, run: RunId): Promise<PlotPageData> {
  const recorded = recordedRun(run);
  const [options, events, titles, files, log] = await Promise.all([
    source.runOptions(run),
    recorded === undefined ? allEvents(source, run) : Promise.resolve(recorded.events),
    recorded === undefined ? liveTitles(source, run) : Promise.resolve(titlesOf(recorded)),
    // Early in a run the sprout may not be readable yet; the areas then come from the events.
    source.repoTree(run, 'sprout').then(
      (tree) => tree.files.map((file) => file.path),
      () => [],
    ),
    source.repoLog(run, 'sprout').catch(() => []),
  ]);
  return {
    options,
    events,
    titles,
    beds: bedsOf([...files, ...eventPaths(events)]),
    stats: Object.fromEntries(log.map((commit) => [commit.sha, commit.files])),
  };
}

async function liveTitles(source: ForgeSource, run: RunId): Promise<Record<string, string>> {
  const beans = await source.beansByPath(run, []);
  return Object.fromEntries(beans.map((bean) => [bean.id, bean.title]));
}

function eventPaths(events: readonly RaceEvent[]): readonly string[] {
  return events.flatMap((event) => (event.type === 'land' ? event.files : []));
}
