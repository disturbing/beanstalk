/**
 * The live adapter: a `ForgeSource` over the gateway's RPC (`@beanstalk/shared-race/rpc`).
 * The gateway serves the repo and the event log; beans' phases, timings and test histories
 * come from reducing that log here, the same way the recorded runs are read.
 */
import type { RunId, Sha, TaskId } from '@beanstalk/shared-race/ids';
import {
  RunId as RunIdSchema,
  Sha as ShaSchema,
  TaskId as TaskIdSchema,
} from '@beanstalk/shared-race/ids';

import type { RaceEvent } from '../race/race-events';
import { parseRaceEvents } from '../race/race-events';
import type { RaceState } from '../race/race-state';
import { reduceRace } from '../race/reduce-race';
import type { FileDiff, RefName, RepoCommit, RepoDiff, TreeFile } from '../repo/repo-types';
import { hunksByPath } from '../repo/unified-patch';
import { beanRecord, decisionRecords, testRecord } from './bean-records';
import type {
  BeanDetail,
  BeanRecord,
  DecideOutcome,
  EventsPage,
  ForgeSource,
  RunListing,
  TestRecord,
} from './forge-source';
import type { GatewayBinding } from './gateway-rpc';
import {
  Accepted,
  BeanDetailAnswer,
  BeanSummaries,
  DecisionAnswers,
  RepoDiffAnswer,
  RepoFileAnswer,
  RepoGrepAnswer,
  RepoLogAnswer,
  RepoTreeLevel,
  RunEventsPage,
  RunListItem,
  RunViewSettings,
  TestCoverages,
  unwrap,
} from './gateway-rpc';

/** Runs listed from the gateway. */
const LISTED_RUNS = 50;
/** Events per page, the gateway's maximum. */
const EVENTS_PAGE = 5000;
/** The gateway's log bound. */
const LOG_LIMIT = 100;

type RunLog = { readonly events: readonly RaceEvent[]; readonly state: RaceState };

export function gatewaySource(binding: GatewayBinding): ForgeSource {
  const logs = new Map<string, Promise<RunLog>>();
  const runLog = (run: RunId): Promise<RunLog> => {
    const cached = logs.get(run);
    if (cached !== undefined) return cached;
    const loaded = readLog(binding, run);
    logs.set(run, loaded);
    return loaded;
  };

  return {
    runOptions: async (run) => {
      const view = unwrap(await binding.runView(run), RunViewSettings);
      return { releaseOnCheck: view.policy_state?.settings?.release_on_check === true };
    },
    listRuns: async () => {
      const items = RunListItem.array().parse(await binding.listRuns(LISTED_RUNS));
      return items.map(toListing);
    },
    runEvents: (run, after, limit) => eventsPage(binding, { run, after, limit }),
    repoTree: async (run, ref) => {
      const { commit, files } = await walkTree(binding, run, ref);
      return { ref, sha: ShaSchema.parse(commit), files };
    },
    repoFile: async (run, ref, path) => {
      const result = await binding.repoFile(run, ref, path);
      if (!result.ok && result.error.status === 404) return undefined;
      const file = unwrap(result, RepoFileAnswer);
      return { ref, sha: ShaSchema.parse(file.commit), path: file.path, text: file.content ?? '' };
    },
    repoDiff: async (run, from, to, paths) =>
      toDiff(unwrap(await binding.repoDiff(run, from, to, paths), RepoDiffAnswer)),
    repoLog: async (run, ref, options) => {
      const answer = unwrap(
        await binding.repoLog(
          run,
          ref,
          options?.paths ?? null,
          Math.min(options?.limit ?? LOG_LIMIT, LOG_LIMIT),
        ),
        RepoLogAnswer,
      );
      return lineCommits(answer.commits, (await runLog(run)).state);
    },
    repoGrep: async (run, ref, pattern, paths) =>
      unwrap(await binding.repoGrep(run, ref, escapeRegExp(pattern), paths), RepoGrepAnswer)
        .matches,
    beansByPath: async (run, paths) => {
      const [summaries, log] = await Promise.all([binding.beansByPath(run, paths), runLog(run)]);
      return toRecords(unwrap(summaries, BeanSummaries), log.state);
    },
    beanDetail: async (run, bean) => beanDetail(binding, { run, bean, log: await runLog(run) }),
    decisions: async (run, paths) => {
      const [answer, log] = await Promise.all([binding.decisions(run, paths), runLog(run)]);
      return mergeDecisions(unwrap(answer, DecisionAnswers), log.state);
    },
    testsFor: async (run, paths) => {
      const [answer, log] = await Promise.all([binding.testsFor(run, paths), runLog(run)]);
      return toTestRecords(unwrap(answer, TestCoverages), log);
    },
    decide: async (run, card, answer) =>
      toOutcome(await binding.decide(run, card, answer.winner, answer.actor, answer.text)),
  };
}

async function readLog(binding: GatewayBinding, run: RunId): Promise<RunLog> {
  const events: RaceEvent[] = [];
  let after = 0;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- pages follow a cursor, one after another
    const page = await eventsPage(binding, { run, after, limit: EVENTS_PAGE });
    events.push(...page.events);
    if (page.done || page.events.length === 0) break;
    after = page.nextAfter;
  }
  return { events, state: reduceRace(events) };
}

async function eventsPage(
  binding: GatewayBinding,
  query: { readonly run: RunId; readonly after: number; readonly limit: number },
): Promise<EventsPage> {
  const page = unwrap(await binding.runEvents(query.run, query.after, query.limit), RunEventsPage);
  return {
    events: parseRaceEvents(page.events).events,
    nextAfter: page.next_after,
    done: page.done,
  };
}

function toListing(item: ReturnType<typeof RunListItem.parse>): RunListing {
  return {
    run: RunIdSchema.parse(item.run),
    source: 'live',
    label: item.policy === 'queue' ? 'Merge queue' : 'Beanstalk v2',
    policy: item.policy === 'queue' ? 'queue' : 'beanstalk',
    phase: item.phase,
    agents: item.agents,
    model: null,
    createdAt: item.created_at,
    beans: item.tasks['total'] ?? 0,
    green: item.tasks['green'] ?? 0,
    costUsd: item.spent_usd,
  };
}

type TreeWalk = { readonly commit: string; readonly files: readonly TreeFile[] };

/** The whole tree at a ref in one recursive call; level by level when the gateway truncates it. */
async function walkTree(binding: GatewayBinding, run: RunId, ref: RefName): Promise<TreeWalk> {
  const whole = unwrap(await binding.repoTree(run, ref, '', true), RepoTreeLevel);
  if (!whole.truncated) return { commit: whole.commit, files: filesOf(whole.entries) };
  return walkLevels(binding, run, ref);
}

/** The whole tree at a ref, one directory level per call, levels in parallel. */
async function walkLevels(binding: GatewayBinding, run: RunId, ref: RefName): Promise<TreeWalk> {
  const files: TreeFile[] = [];
  let commit = '';
  let level: readonly string[] = [''];
  while (level.length > 0) {
    // oxlint-disable-next-line no-await-in-loop -- each level of the tree needs the one above it
    const answers = await Promise.all(
      level.map(async (path) => unwrap(await binding.repoTree(run, ref, path), RepoTreeLevel)),
    );
    commit = answers[0]?.commit ?? commit;
    const entries = answers.flatMap((answer) => answer.entries);
    files.push(...filesOf(entries));
    level = entries.filter((entry) => entry.type === 'tree').map((entry) => entry.path);
  }
  return { commit, files };
}

function filesOf(entries: readonly { readonly path: string; readonly type: string }[]): TreeFile[] {
  return entries
    .filter((entry) => entry.type !== 'tree' && entry.type !== 'gitlink')
    .map((entry) => ({ path: entry.path, size: 0 }));
}

function toDiff(answer: ReturnType<typeof RepoDiffAnswer.parse>): RepoDiff {
  const hunks = hunksByPath(answer.patch);
  const files: FileDiff[] = answer.files.map((file) => ({
    ...file,
    hunks: hunks.get(file.path) ?? [],
  }));
  return {
    from: ShaSchema.parse(answer.from.commit),
    to: ShaSchema.parse(answer.to.commit),
    files,
  };
}

/** Line commits only (the base is not one), with the bean, position and time from the log. */
function lineCommits(
  commits: ReturnType<typeof RepoLogAnswer.parse>['commits'],
  state: RaceState,
): readonly RepoCommit[] {
  const landed = new Map(state.line.commits.map((commit) => [commit.sha, commit]));
  return commits.flatMap((commit) => {
    const line = landed.get(ShaSchema.parse(commit.sha));
    if (line === undefined) return [];
    return [
      {
        sha: line.sha,
        parent: commit.parents[0] === undefined ? null : ShaSchema.parse(commit.parents[0]),
        title: commit.message.split('\n')[0] ?? '',
        task: line.task,
        kind: line.kind,
        idx: line.idx,
        t: line.t,
        files: line.files.map((path) => ({
          path,
          status: 'modified' as const,
          additions: 0,
          deletions: 0,
        })),
      },
    ];
  });
}

function toRecords(
  summaries: ReturnType<typeof BeanSummaries.parse>,
  state: RaceState,
): readonly BeanRecord[] {
  return summaries.flatMap((summary) => {
    const bean = state.beans[summary.bean];
    return bean === undefined
      ? []
      : [
          beanRecord(
            bean,
            { title: summary.title, intent: summary.intent ?? '', tests: [] },
            summary.files,
          ),
        ];
  });
}

async function beanDetail(
  binding: GatewayBinding,
  input: { readonly run: RunId; readonly bean: TaskId; readonly log: RunLog },
): Promise<BeanDetail | undefined> {
  const result = await binding.beanDetail(input.run, input.bean);
  if (!result.ok && result.error.status === 404) return undefined;
  const detail = unwrap(result, BeanDetailAnswer);
  const bean = input.log.state.beans[input.bean];
  if (bean === undefined) return undefined;
  const tests = detail.acceptance.map((test) => test.path);
  const record = beanRecord(
    bean,
    { title: detail.title, intent: detail.intent, tests },
    detail.files,
  );
  const range = ownChange(input.log.state, {
    landed: detail.landed_sha,
    base: detail.base_sha,
    head: detail.head_sha,
  });
  return {
    ...record,
    tests,
    steps: bean.steps,
    head: bean.head,
    diffBase: range?.base ?? null,
    diffHead: range?.head ?? null,
    checks: bean.checks,
    redChecks: bean.redChecks,
    conflicts: bean.conflicts,
    lastMessage: bean.lastMessage,
    dropReason: bean.dropReason,
  };
}

/** A landed bean's own change is its line commit; an unlanded one, its branch vs its base. */
function ownChange(
  state: RaceState,
  shas: {
    readonly landed: string | null;
    readonly base: string | null;
    readonly head: string | null;
  },
): { readonly base: Sha; readonly head: Sha } | undefined {
  const commits = state.line.commits;
  const at = commits.findIndex((commit) => commit.sha === shas.landed);
  const landed = commits[at];
  if (landed !== undefined) {
    const parent = at === 0 ? state.meta?.base : commits[at - 1]?.sha;
    return parent === undefined ? undefined : { base: parent, head: landed.sha };
  }
  if (shas.base === null || shas.head === null) return undefined;
  return { base: ShaSchema.parse(shas.base), head: ShaSchema.parse(shas.head) };
}

function mergeDecisions(answers: ReturnType<typeof DecisionAnswers.parse>, state: RaceState) {
  const byCard = new Map(answers.map((answer) => [answer.card, answer]));
  const records = new Map(
    Object.values(state.beans).map((bean) => [bean.id, beanRecord(bean, undefined, undefined)]),
  );
  return decisionRecords(state, records, undefined).flatMap((card) => {
    const answer = byCard.get(card.card);
    return answer === undefined
      ? []
      : [{ ...card, files: answer.files, oracle: answer.by ?? card.oracle }];
  });
}

function toTestRecords(
  coverages: ReturnType<typeof TestCoverages.parse>,
  log: RunLog,
): readonly TestRecord[] {
  return coverages.map((coverage) => {
    const owner = TaskIdSchema.safeParse(coverage.task);
    const ownerId = owner.success ? owner.data : null;
    return testRecord({
      path: coverage.test,
      covers: coverage.covers,
      owner: ownerId,
      existsFrom:
        ownerId === null ? 0 : (log.state.beans[ownerId]?.landedAt ?? Number.POSITIVE_INFINITY),
      events: log.events,
    });
  });
}

function toOutcome(result: Awaited<ReturnType<GatewayBinding['decide']>>): DecideOutcome {
  if (result.ok) {
    Accepted.parse(result.value);
    return { ok: true };
  }
  const { code, message } = result.error;
  if (code === 'unknown_card' || code === 'invalid_winner' || code === 'invalid_state')
    return { ok: false, code, message };
  return { ok: false, code: 'unavailable', message };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
