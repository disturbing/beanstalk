/**
 * What the repository home needs from the server: every event so far (the client reduces
 * them at the playhead), the beans' titles, the repository's files, and who the agent
 * sessions belong to, for a recorded or a live run.
 */
import type { RunId } from '@beanstalk/shared-race/ids';

import { allEvents } from '@beanstalk/shared-ask/ask/plan-context';
import type { ForgeSource } from '@beanstalk/shared-ask/forge/forge-source';
import type { SessionDirectory } from '@beanstalk/shared-ask/home/sessions';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import type { RaceOptions } from '@beanstalk/shared-ask/race/race-state';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';
import { sessionsFor } from '../people/sessions';
import { titlesOf } from '../recorded/race-pair';
import { recordedRun } from '../recorded/recorded-runs';

export type HomePageData = {
  readonly options: RaceOptions;
  readonly events: readonly RaceEvent[];
  readonly titles: Readonly<Record<string, string>>;
  /** The repository's files at the sprout. */
  readonly files: readonly string[];
  readonly sessions: SessionDirectory;
};

export async function homePageData(source: ForgeSource, run: RunId): Promise<HomePageData> {
  const recorded = recordedRun(run);
  const [options, events, titles, files] = await Promise.all([
    source.runOptions(run),
    recorded === undefined ? allEvents(source, run) : Promise.resolve(recorded.events),
    recorded === undefined ? liveTitles(source, run) : Promise.resolve(titlesOf(recorded)),
    // Early in a run the sprout may not be readable yet; the explorer then lists no files.
    source.repoTree(run, 'sprout').then(
      (tree) => tree.files.map((file) => file.path),
      () => [],
    ),
  ]);
  return {
    options,
    events,
    titles,
    files,
    sessions: sessionsFor(run, reduceRace(events, options)),
  };
}

async function liveTitles(source: ForgeSource, run: RunId): Promise<Record<string, string>> {
  const beans = await source.beansByPath(run, []);
  return Object.fromEntries(beans.map((bean) => [bean.id, bean.title]));
}
