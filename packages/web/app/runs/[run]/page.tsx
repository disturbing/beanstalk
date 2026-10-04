import { env } from 'cloudflare:workers';
import { notFound } from 'next/navigation';

import { RunId, TaskId } from '@beanstalk/shared-race/ids';

import type { Answer } from '@beanstalk/shared-ask/ask/answer';
import { classifierFrom } from '@beanstalk/shared-ask/ask/classifier-from-env';
import { classifyByKeywords } from '@beanstalk/shared-ask/ask/classifier';
import { planAnswer } from '@beanstalk/shared-ask/ask/plan-answer';
import { isForgeError } from '@beanstalk/shared-ask/forge/forge-errors';
import type { ForgeSource } from '@beanstalk/shared-ask/forge/forge-source';
import {
  isFinished,
  leadDecision,
  leadFacts,
  leadKey,
  suggestDecision,
  suggestions,
} from '@beanstalk/shared-ask/pick/lead';
import type { Picker } from '@beanstalk/shared-ask/pick/picker';
import { busiestMoment } from '@beanstalk/shared-ask/plot/busiest-moment';
import type { PlotFocus } from '@beanstalk/shared-ask/plot/plot-model';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';
import { PlotDetail } from '../../../components/plot/plot-detail';
import type { PlotState } from '../../../components/plot/plot-url';
import { readPlotState } from '../../../components/plot/plot-url';
import type { PlotAnswerView } from '../../../components/plot/plot-workspace';
import { PlotWorkspace } from '../../../components/plot/plot-workspace';
import { forgeForRun } from '../../../src/forge/sources';
import { isRecordedRun } from '../../../src/recorded/recorded-runs';
import { pagePicker } from '../../../src/server/picker';
import { plotPageData } from '../../../src/server/plot-page-data';
import { runMeta } from '../../../src/server/run-meta';

type PageProps = {
  readonly params: Promise<{ readonly run: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { run } = await params;
  return { title: `race-${run}` };
}

/** The repository's home: the Plot (`docs/claude-opus/14`). */
export default async function PlotPage({ params, searchParams }: PageProps) {
  const parsedRun = RunId.safeParse((await params).run);
  if (!parsedRun.success) notFound();
  const run = parsedRun.data;
  const recorded = isRecordedRun(run);
  const data = await plotPageData(forgeForRun(env.GATEWAY, run), run).catch(notFoundOr);
  const url = withMoment(readPlotState(await searchParams), data.events, recorded);
  const picker = pagePicker();
  const answer = needsAnswer(url) ? await answerFor({ run, url, picker }) : null;
  const visible =
    url.t === null ? data.events : data.events.filter((event) => event.t <= (url.t ?? 0));
  const state = reduceRace(visible, data.options);
  const now = url.t ?? state.endedAt ?? state.clock;
  const finished = isFinished(state, now);
  const facts = leadFacts(state, now);
  const items = suggestions(state, now);
  const [lead, suggest] = await Promise.all([
    answer === null || url.q === ''
      ? picker.decide(leadDecision(facts, finished))
      : Promise.resolve(null),
    picker.decide(suggestDecision(items, !finished)),
  ]);
  const meta = runMeta(run, reduceRace(data.events, data.options));
  return (
    <main>
      <PlotWorkspace
        run={run}
        label={meta.label}
        mode={recorded ? 'replay' : 'live'}
        events={data.events}
        options={data.options}
        titles={data.titles}
        beds={data.beds}
        stats={data.stats}
        url={url}
        initialT={url.t}
        answer={answer === null || url.q === '' ? null : answerView(answer)}
        suggestions={items}
        receipts={[suggest, ...(answer?.picks ?? [])]}
        initialLead={lead === null ? null : { key: leadKey(facts, finished), receipt: lead }}
        picker={picker.name}
      >
        {answer === null ? undefined : <PlotDetail run={run} url={url} answer={answer} />}
      </PlotWorkspace>
    </main>
  );
}

function needsAnswer(url: PlotState): boolean {
  return url.q !== '' || url.bean !== null || url.file !== null;
}

async function answerFor(input: {
  readonly run: RunId;
  readonly url: PlotState;
  readonly picker: Picker;
}): Promise<Answer> {
  const { run, url } = input;
  const source: ForgeSource = forgeForRun(env.GATEWAY, run, url.t === null ? {} : { asOf: url.t });
  return planAnswer({
    source,
    run,
    question: url.q,
    classifier: classifierFrom({
      name: env.ASK_CLASSIFIER,
      model: env.ASK_AI_MODEL,
      ai: Reflect.get(env, 'AI'),
    }),
    removed: url.removed,
    ref: null,
    selection: {
      file: url.file,
      bean: TaskId.safeParse(url.bean).data ?? null,
      view: url.file === null ? null : 'blame',
    },
    picker: input.picker,
  }).catch(notFoundOr);
}

/** Folds the Plot to the answer: matched files as columns, or every area for swarm questions. */
function answerView(answer: Answer): PlotAnswerView {
  const beans = answer.rail.flatMap((block) =>
    block.kind === 'beans' || block.kind === 'promotion' ? block.beans.map((bean) => bean.id) : [],
  );
  const mainBeans = answer.main.kind === 'beans' ? answer.main.beans.map((bean) => bean.id) : [];
  const layout =
    answer.spec.class === 'in-flight' || answer.spec.class === 'agent-activity' ? 'beds' : 'files';
  const focus: PlotFocus = {
    files: answer.tree.matched,
    beans: [...new Set([...beans, ...mainBeans])],
    layout,
  };
  return {
    headline: answer.headline,
    focus,
    chips: answer.chips
      .filter((chip) => chip.kind !== 'file')
      .map((chip) => ({ id: chip.id, label: chip.label })),
    routeReceipt: answer.picks.find((receipt) => receipt.decision === 'route') ?? null,
    filesReceipt: answer.picks.find((receipt) => receipt.decision === 'files') ?? null,
  };
}

/** "What is the swarm doing now?" on a finished recording opens at its busiest moment. */
function withMoment(url: PlotState, events: readonly RaceEvent[], recorded: boolean): PlotState {
  if (!recorded || url.t !== null || url.q === '') return url;
  if (classifyByKeywords(url.q, 'sprout').class !== 'in-flight') return url;
  return { ...url, t: busiestMoment(events) };
}

function notFoundOr(error: unknown): never {
  if (isForgeError(error, 'not_found')) notFound();
  throw error;
}
