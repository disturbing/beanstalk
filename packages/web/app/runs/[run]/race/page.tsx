import { env } from 'cloudflare:workers';
import { notFound } from 'next/navigation';

import { RunId } from '@beanstalk/shared-race/ids';

import styles from '../../../../components/explorer/explorer.module.css';
import type { DecisionAccess } from '../../../../components/canvas/decision-panel';
import { RaceCanvas } from '../../../../components/canvas/race-canvas';
import type { Speed } from '../../../../components/canvas/use-replay-clock';
import { RunHeader } from '../../../../components/explorer/run-header';
import { isForgeError } from '../../../../src/forge/forge-errors';
import { forgeForRun } from '../../../../src/forge/sources';
import { reduceRace } from '../../../../src/race/reduce-race';
import { isRecordedRun } from '../../../../src/recorded/recorded-runs';
import { racePageData } from '../../../../src/server/race-page-data';
import { runMeta } from '../../../../src/server/run-meta';
import { demoPassword, isSignedIn } from '../../../../src/server/viewer';

type PageProps = {
  readonly params: Promise<{ readonly run: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/** A recorded race opens at minute 10, mid-race, unless the link says otherwise. */
const DEFAULT_REPLAY_SECONDS = 600;

export async function generateMetadata({ params }: PageProps) {
  const { run } = await params;
  return { title: `Race canvas, race-${run}` };
}

export default async function RaceCanvasPage({ params, searchParams }: PageProps) {
  const parsedRun = RunId.safeParse((await params).run);
  if (!parsedRun.success) notFound();
  const run = parsedRun.data;
  const query = await searchParams;
  const recorded = isRecordedRun(run);
  const data = await racePageData(forgeForRun(env.GATEWAY, run), run).catch((error: unknown) => {
    if (isForgeError(error, 'not_found')) notFound();
    throw error;
  });
  const meta = runMeta(run, reduceRace(data.events));
  return (
    <main className={styles.page}>
      <RunHeader run={run} label={meta.label} detail={meta.detail} current="race" />
      <RaceCanvas
        run={run}
        label={meta.label}
        mode={recorded ? 'replay' : 'live'}
        events={data.events}
        titles={data.titles}
        files={data.files}
        initialT={recorded ? (numberParam(query['t']) ?? DEFAULT_REPLAY_SECONDS) : null}
        initialSpeed={speedParam(query['speed'])}
        access={await decisionAccess(run, recorded)}
        options={data.options}
      />
    </main>
  );
}

async function decisionAccess(run: string, recorded: boolean): Promise<DecisionAccess> {
  if (recorded) return { kind: 'recorded' };
  if (demoPassword() === '') return { kind: 'off' };
  return (await isSignedIn())
    ? { kind: 'allowed' }
    : { kind: 'sign-in', next: `/runs/${run}/race` };
}

function numberParam(value: string | string[] | undefined): number | null {
  const parsed = Number(typeof value === 'string' ? value : undefined);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function speedParam(value: string | string[] | undefined): Speed {
  if (value === '1') return 1;
  if (value === '60') return 60;
  return 10;
}
