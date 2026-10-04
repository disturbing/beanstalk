import { env } from 'cloudflare:workers';
import { notFound } from 'next/navigation';

import { RunId, TaskId } from '@beanstalk/shared-race/ids';

import { AnswerPanel } from '../../../components/explorer/answer-panel';
import type { Suggestion } from '../../../components/explorer/ask-bar';
import { AskBar } from '../../../components/explorer/ask-bar';
import styles from '../../../components/explorer/explorer.module.css';
import { readExplorerState } from '../../../components/explorer/explorer-url';
import { FileTree } from '../../../components/explorer/file-tree';
import { MainPane } from '../../../components/explorer/main-pane';
import { RailBlocks } from '../../../components/explorer/rail-blocks';
import { RunHeader } from '../../../components/explorer/run-header';
import { classifierFrom } from '../../../src/ask/classifier-from-env';
import { planAnswer } from '../../../src/ask/plan-answer';
import { CATALOG } from '../../../src/ask/view-spec';
import { isForgeError } from '../../../src/forge/forge-errors';
import { forgeForRun } from '../../../src/forge/sources';
import { raceMoments } from '../../../src/race/race-moments';
import { reduceRace } from '../../../src/race/reduce-race';
import { recordedRun } from '../../../src/recorded/recorded-runs';
import { runMeta } from '../../../src/server/run-meta';

type PageProps = {
  readonly params: Promise<{ readonly run: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { run } = await params;
  return { title: `race-${run}` };
}

/** The demo questions for the recorded v2 run (`docs/claude-opus/13` §3, `12` beat 3). */
const V2_SUGGESTIONS: readonly Suggestion[] = [
  { q: 'what changed recently on coupons?' },
  { q: 'who changed tax rounding and why?' },
  { q: 'why did the sprout go red?' },
  { q: 'what did we decide about money formatting?' },
  { q: "what's being worked on in billing right now?", at: 600 },
  { q: "what's on sprout but not on stalk?", at: 600 },
  { q: 'what tests cover checkout?' },
  { q: 'show bean t032' },
];

export default async function ExplorerPage({ params, searchParams }: PageProps) {
  const parsedRun = RunId.safeParse((await params).run);
  if (!parsedRun.success) notFound();
  const run = parsedRun.data;
  const state = readExplorerState(await searchParams);
  const recorded = recordedRun(run);
  const source = forgeForRun(env.GATEWAY, run, state.at === null ? {} : { asOf: state.at });
  const answer = await planAnswer({
    source,
    run,
    question: state.q,
    classifier: classifierFrom({
      name: env.ASK_CLASSIFIER,
      model: env.ASK_AI_MODEL,
      ai: Reflect.get(env, 'AI'),
    }),
    removed: state.removed,
    ref: state.ref,
    selection: {
      file: state.file,
      bean: TaskId.safeParse(state.bean).data ?? null,
      view: state.view,
    },
  }).catch((error: unknown) => {
    if (isForgeError(error, 'not_found')) notFound();
    throw error;
  });
  const events = recorded?.events ?? [];
  const race = reduceRace(events);
  const meta = recorded === undefined ? { label: 'Live run', detail: '' } : runMeta(run, race);
  const suggestions =
    recorded?.label === 'Beanstalk v2'
      ? V2_SUGGESTIONS
      : Object.values(CATALOG).map((entry) => ({ q: entry.example }));
  return (
    <main className={styles.page}>
      <RunHeader run={run} label={meta.label} detail={meta.detail} current="repository" />
      <AskBar
        run={run}
        state={state}
        policy={answer.policy}
        moments={recorded === undefined ? null : raceMoments(events)}
        endedAt={race.endedAt}
        suggestions={suggestions}
      />
      <AnswerPanel run={run} state={state} answer={answer} />
      <div className={styles.panes}>
        <nav className={`${styles.pane} ${styles.treePane}`} aria-label="Repository files">
          <div className={styles.paneHead}>
            <span className={styles.paneTitle}>
              {answer.tree.mode === 'filtered' ? 'In this answer' : 'Files'}
            </span>
            <span className={styles.paneSub} title={`${answer.ref.name} at ${answer.ref.sha}`}>
              {answer.tree.files.length} at {answer.ref.name} {answer.ref.sha.slice(0, 7)}
            </span>
          </div>
          <div className={styles.paneBody}>
            <FileTree run={run} state={state} tree={answer.tree} selected={state.file} />
          </div>
        </nav>
        <section className={styles.pane} aria-label="Main view">
          <MainPane
            run={run}
            state={state}
            main={answer.main}
            railBean={answer.rail.find((block) => block.kind === 'checks')?.bean ?? null}
          />
        </section>
        <aside className={styles.railPane} aria-label="Context">
          <RailBlocks run={run} state={state} blocks={answer.rail} />
        </aside>
      </div>
    </main>
  );
}
