import { env } from 'cloudflare:workers';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import type { RunId } from '@beanstalk/shared-race/ids';
import { RunId as RunIdSchema, TaskId } from '@beanstalk/shared-race/ids';

import type { Answer } from '@beanstalk/shared-ask/ask/answer';
import { classifierFrom } from '@beanstalk/shared-ask/ask/classifier-from-env';
import { classifyByKeywords } from '@beanstalk/shared-ask/ask/classifier';
import { planAnswer } from '@beanstalk/shared-ask/ask/plan-answer';
import { isForgeError } from '@beanstalk/shared-ask/forge/forge-errors';
import type { ForgeSource } from '@beanstalk/shared-ask/forge/forge-source';
import { busiestMoment } from '@beanstalk/shared-ask/home/busiest-moment';
import { composeAnswer } from '@beanstalk/shared-ask/home/composition';
import { isFinished, suggestDecision, suggestions } from '@beanstalk/shared-ask/pick/lead';
import type { Picker } from '@beanstalk/shared-ask/pick/picker';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';
import {
  ExplorerAnswer,
  FinishedAnswer,
  workingOn,
} from '../../../components/home/explorer-answer';
import type { HomeState } from '../../../components/home/home-url';
import { readHomeState } from '../../../components/home/home-url';
import { HomeWorkspace } from '../../../components/home/home-workspace';
import { RepoHead, TAB_QUESTIONS, tabOf } from '../../../components/home/repo-head';
import { forgeForRun } from '../../../src/forge/sources';
import { repositoryOf } from '../../../src/people/repository';
import { isRecordedRun } from '../../../src/recorded/recorded-runs';
import type { HomePageData } from '../../../src/server/home-page-data';
import { homePageData } from '../../../src/server/home-page-data';
import { pagePicker } from '../../../src/server/picker';

type PageProps = {
  readonly params: Promise<{ readonly run: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export async function generateMetadata({ params }: PageProps) {
  const parsed = RunIdSchema.safeParse((await params).run);
  const repository = parsed.success ? repositoryOf(parsed.data) : null;
  return { title: repository === null ? 'Repository' : `${repository.owner}/${repository.name}` };
}

/** The repository's home: the stalk and the generated explorer (`docs/claude-opus/14` §10). */
export default async function RepositoryHome({ params, searchParams }: PageProps) {
  const parsedRun = RunIdSchema.safeParse((await params).run);
  if (!parsedRun.success) notFound();
  const run = parsedRun.data;
  const recorded = isRecordedRun(run);
  const data = await homePageData(forgeForRun(env.GATEWAY, run), run).catch(notFoundOr);
  const url = readHomeState(await searchParams);
  const picker = pagePicker();
  const visible =
    url.t === null ? data.events : data.events.filter((event) => event.t <= (url.t ?? 0));
  const state = reduceRace(visible, data.options);
  const now = url.t ?? state.endedAt ?? state.clock;
  const finished = isFinished(state, now);
  const items = suggestions(state, now);
  const [suggest, explorer] = await Promise.all([
    picker.decide(suggestDecision(items, !finished)),
    explorerFor({ run, url, picker, data, finished, now }),
  ]);
  const repository = repositoryOf(run);
  const ordered = suggest.chosen.flatMap((id) =>
    items.filter((item) => item.id === id).map((item) => item.question),
  );
  return (
    <main>
      <RepoHead
        run={run}
        repository={repository}
        current={url.bean === null ? tabOf(url.q) : 'code'}
      />
      <HomeWorkspace
        run={run}
        owner={repository.owner}
        mode={recorded ? 'replay' : 'live'}
        events={data.events}
        options={data.options}
        titles={data.titles}
        files={data.files}
        sessions={data.sessions}
        url={url}
        relevant={explorer?.relevant ?? null}
        questions={[
          ...new Set([
            ...ordered,
            ...Object.values(TAB_QUESTIONS),
            "what's on sprout but not on stalk?",
          ]),
        ]}
        suggestReceipt={suggest}
        receipts={[suggest, ...(explorer?.receipts ?? [])]}
        picker={picker.name}
      >
        {explorer?.node}
      </HomeWorkspace>
    </main>
  );
}

type Explorer = {
  readonly node: ReactNode;
  readonly relevant: readonly string[];
  readonly receipts: Answer['picks'];
};

/** The explorer for a question or a bean; null for the defaults (nothing asked). */
async function explorerFor(input: {
  readonly run: RunId;
  readonly url: HomeState;
  readonly picker: Picker;
  readonly data: HomePageData;
  readonly finished: boolean;
  readonly now: number;
}): Promise<Explorer | null> {
  const { run, url, data } = input;
  if (url.q === '' && url.bean === null) return null;
  if (
    url.bean === null &&
    input.finished &&
    classifyByKeywords(url.q, 'sprout').class === 'in-flight'
  ) {
    return {
      node: (
        <FinishedAnswer
          run={run}
          url={url}
          finishedAt={input.now}
          busiest={busiestMoment(data.events)}
        />
      ),
      relevant: [],
      receipts: [],
    };
  }
  const bean = TaskId.safeParse(url.bean).data ?? null;
  const answer = await planAnswer({
    source: forgeForRun(env.GATEWAY, run, url.t === null ? {} : { asOf: url.t }),
    run,
    question: url.q,
    classifier: classifierFrom({
      name: env.ASK_CLASSIFIER,
      model: env.ASK_AI_MODEL,
      ai: Reflect.get(env, 'AI'),
    }),
    removed: url.removed,
    ref: null,
    selection: { file: null, bean, view: null },
    picker: input.picker,
  }).catch(notFoundOr);
  const source = forgeForRun(env.GATEWAY, run, url.t === null ? {} : { asOf: url.t });
  const featured = await featuredBean(source, run, answer, bean);
  const base = composeAnswer(answer, bean);
  const composition =
    featured === null ? base : { ...base, components: [...base.components, 'journey' as const] };
  const visible =
    url.t === null ? data.events : data.events.filter((event) => event.t <= (url.t ?? 0));
  const state = reduceRace(visible, data.options);
  const working =
    answer.spec.class === 'in-flight' ? workingOn(state, answer.spec.entities.feature) : [];
  const swarm = working.map((busy) => busy.id);
  const feature = answer.spec.entities.feature?.toLowerCase() ?? '';
  const swarmFiles = working.flatMap((busy) =>
    busy.files.filter((file) => feature === '' || file.toLowerCase().includes(feature)),
  );
  const shown =
    swarmFiles.length === 0
      ? composition
      : { ...composition, files: [...new Set([...composition.files, ...swarmFiles])].toSorted() };
  return {
    node: (
      <ExplorerAnswer
        run={run}
        url={url}
        answer={answer}
        composition={shown}
        state={state}
        events={visible}
        now={input.now}
        titles={data.titles}
        sessions={data.sessions}
        featured={featured}
      />
    ),
    relevant: [...composition.relevant, ...swarm],
    receipts: answer.picks,
  };
}

/** Classes whose answer is about recent change: feature the newest bean it is about. */
const FEATURE_CLASSES = new Set(['recent-changes', 'who-why']);

async function featuredBean(
  source: ForgeSource,
  run: RunId,
  answer: Answer,
  selected: TaskId | null,
) {
  if (selected !== null || !FEATURE_CLASSES.has(answer.spec.class)) return null;
  const wanted = new Set(answer.tree.matched);
  const newest = answer.rail
    .flatMap((block) => (block.kind === 'beans' ? block.beans : []))
    .filter((bean) => bean.landedIdx !== null && bean.files.some((file) => wanted.has(file)))
    .toSorted((a, b) => (b.landedIdx ?? 0) - (a.landedIdx ?? 0))[0];
  if (newest === undefined) return null;
  const detail = await source.beanDetail(run, newest.id);
  if (detail === undefined) return null;
  const diff =
    detail.diffBase === null || detail.diffHead === null
      ? null
      : await source.repoDiff(run, detail.diffBase, detail.diffHead);
  return { bean: detail, files: diff?.files ?? [] };
}

function notFoundOr(error: unknown): never {
  if (isForgeError(error, 'not_found')) notFound();
  throw error;
}
