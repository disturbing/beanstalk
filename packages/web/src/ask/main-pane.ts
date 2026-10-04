/**
 * The main pane of an answer: a combined diff, a file (with the range's lines or blame by
 * bean), one bean, or a list of beans, chosen by the question class or the user's pick.
 */
import type { Sha, TaskId } from '@beanstalk/shared-race/ids';

import { changedLines } from '../repo/file-diff';
import { isTestFile } from '../repo/imports';
import type { RepoCommit, RepoDiff } from '../repo/repo-types';
import type { MainPane } from './answer';
import type { FileVersion } from './blame';
import { blameByBean } from './blame';
import type { FileSet } from './file-set';
import { agentBeans, failingTestFiles, inFlightBeans, testPathOf } from './file-set';
import type { PlanContext } from './plan-context';
import { featureStems } from './question-words';

export async function mainPaneFor(ctx: PlanContext, set: FileSet): Promise<MainPane> {
  const { selection } = ctx;
  if (selection.bean !== null) return beanPane(ctx, selection.bean);
  if (selection.file !== null) {
    return selection.view === 'diff'
      ? diffPane(ctx, [selection.file])
      : filePane(ctx, selection.file, { blame: ctx.spec.class === 'who-why' });
  }
  return classPane(ctx, set);
}

function classPane(ctx: PlanContext, set: FileSet): Promise<MainPane> {
  switch (ctx.spec.class) {
    case 'recent-changes':
      return diffPane(ctx, set.files);
    case 'who-why':
      return firstFile(ctx, set.files, { blame: true });
    case 'in-flight':
      return inFlightPane(ctx, set.files);
    case 'what-broke':
      return culpritPane(ctx);
    case 'pending-promotion':
      return promotionPane(ctx, set.files);
    case 'decisions':
      return decisionPane(ctx);
    case 'tests-for': {
      const test = set.files.find(isTestFile);
      return test === undefined
        ? Promise.resolve(empty('Tests', 'No test covers this code at this ref.'))
        : filePane(ctx, test, { blame: false });
    }
    case 'agent-activity':
      return Promise.resolve(agentPane(ctx));
    case 'bean':
      return ctx.spec.entities.bean === null
        ? Promise.resolve(empty('Bean', 'Name a bean, like t032.'))
        : beanPane(ctx, ctx.spec.entities.bean);
    case 'explore':
      return explorePane(ctx, set);
    default:
      return assertNever(ctx.spec.class);
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected class ${String(value)}`);
}

function empty(title: string, message: string): MainPane {
  return { kind: 'empty', title, message };
}

async function diffPane(ctx: PlanContext, files: readonly string[]): Promise<MainPane> {
  if (files.length === 0) return empty('Changes', 'Nothing changed in this range.');
  const diff = await ctx.source.repoDiff(ctx.run, ctx.range.fromSha, ctx.tree.sha, files);
  if (diff.files.length === 0) return empty('Changes', 'These files did not change in this range.');
  return {
    kind: 'diff',
    title: `${diff.files.length} changed file${diff.files.length === 1 ? '' : 's'}`,
    diff: inAnswerOrder(diff, files),
    fromLabel: commitLabel(ctx, ctx.range.fromSha),
    toLabel: commitLabel(ctx, ctx.tree.sha),
  };
}

/** Code before tests, each in the answer's order (the resolver's rank, else the path). */
function inAnswerOrder(diff: RepoDiff, files: readonly string[]): RepoDiff {
  const order = new Map(files.map((path, index) => [path, index]));
  const rank = (path: string) =>
    (isTestFile(path) ? files.length : 0) + (order.get(path) ?? files.length);
  return { ...diff, files: diff.files.toSorted((a, b) => rank(a.path) - rank(b.path)) };
}

/** `sprout #12`, `stalk #12`, or `base` for a commit of the line. */
function commitLabel(ctx: PlanContext, sha: Sha): string {
  const commit = ctx.log.find((candidate) => candidate.sha === sha);
  if (commit === undefined) return sha === ctx.log.at(-1)?.parent ? 'base' : sha.slice(0, 8);
  const line = ctx.state.meta?.policy === 'queue' ? 'stalk' : 'sprout';
  return `${line} #${commit.idx ?? '?'}`;
}

async function filePane(
  ctx: PlanContext,
  path: string,
  options: { readonly blame: boolean; readonly searchHits?: boolean },
): Promise<MainPane> {
  const file = await ctx.source.repoFile(ctx.run, ctx.refName, path);
  if (file === undefined) return empty(path, 'This file is not on this line.');
  const [highlights, blame] = await Promise.all([
    options.searchHits === true ? searchHits(ctx, path) : rangeLines(ctx, path),
    options.blame ? blameOf(ctx, path) : Promise.resolve(null),
  ]);
  return { kind: 'file', title: path, file, highlights, blame };
}

/** Lines the range changed; none for a file the range created (every line would be). */
async function rangeLines(ctx: PlanContext, path: string): Promise<readonly number[]> {
  const diff = await ctx.source.repoDiff(ctx.run, ctx.range.fromSha, ctx.tree.sha, [path]);
  const file = diff.files[0];
  if (file === undefined || file.status === 'added') return [];
  return [...changedLines(file)];
}

async function searchHits(ctx: PlanContext, path: string): Promise<readonly number[]> {
  const feature = ctx.spec.entities.feature;
  if (feature === null) return [];
  const hits = await Promise.all(
    featureStems(feature).map((stem) => ctx.source.repoGrep(ctx.run, ctx.refName, stem, [path])),
  );
  return [
    ...new Set(
      hits
        .flat()
        .filter((hit) => hit.path === path)
        .map((hit) => hit.line),
    ),
  ];
}

/** Blame by bean over every version of the file on the line, from the base on. */
async function blameOf(ctx: PlanContext, path: string) {
  const touching = ctx.log.filter((commit) => commit.files.some((file) => file.path === path));
  const base = ctx.log.at(-1)?.parent ?? null;
  const [baseText, ...texts] = await Promise.all([
    base === null ? Promise.resolve(undefined) : ctx.source.repoFile(ctx.run, base, path),
    ...touching.toReversed().map((commit) => ctx.source.repoFile(ctx.run, commit.sha, path)),
  ]);
  const versions: FileVersion[] = [
    { task: null, idx: null, text: baseText?.text ?? '' },
    ...touching.toReversed().map((commit: RepoCommit, index) => ({
      task: commit.task,
      idx: commit.idx,
      text: texts[index]?.text ?? '',
    })),
  ];
  return blameByBean(versions);
}

function firstFile(
  ctx: PlanContext,
  files: readonly string[],
  options: { readonly blame: boolean },
): Promise<MainPane> {
  const changed = new Set(
    ctx.range.commits.flatMap((commit) => commit.files.map((file) => file.path)),
  );
  const pick = files.find((path) => !isTestFile(path) && changed.has(path)) ?? files[0];
  return pick === undefined
    ? Promise.resolve(empty('Files', 'No file answers this question at this ref.'))
    : filePane(ctx, pick, options);
}

async function beanPane(ctx: PlanContext, id: TaskId): Promise<MainPane> {
  const bean = await ctx.source.beanDetail(ctx.run, id);
  if (bean === undefined) return empty(id, `This run has no bean ${id}.`);
  const diff =
    bean.diffBase === null || bean.diffHead === null
      ? null
      : await ctx.source.repoDiff(ctx.run, bean.diffBase, bean.diffHead);
  return { kind: 'bean', bean, diff };
}

/** The bean in flight with the most stake in these files. */
function inFlightPane(ctx: PlanContext, files: readonly string[]): Promise<MainPane> {
  const wanted = new Set(files);
  const busiest = inFlightBeans(ctx)
    .map((bean) => ({ bean, shared: bean.files.filter((file) => wanted.has(file)).length }))
    .toSorted((a, b) => b.shared - a.shared || b.bean.reworks - a.bean.reworks)
    .at(0);
  return busiest === undefined
    ? Promise.resolve(empty('In flight', 'Nothing is in flight on these files right now.'))
    : beanPane(ctx, busiest.bean.id);
}

/** The newest culprit: a repair ticket's, a queue bisection's, or a decision's landed side. */
function culpritPane(ctx: PlanContext): Promise<MainPane> {
  const culprit = latestCulprit(ctx);
  if (culprit !== undefined) return beanPane(ctx, culprit);
  const failing = failingTestFiles(ctx)[0];
  return failing === undefined
    ? Promise.resolve(empty('What broke', 'Nothing went red in this range.'))
    : filePane(ctx, failing, { blame: false });
}

export function latestCulprit(ctx: PlanContext): TaskId | undefined {
  const fromTickets = ctx.state.tickets
    .toReversed()
    .find((ticket) => ticket.culprit !== null)?.culprit;
  const fromBisect = ctx.state.batches
    .toReversed()
    .find((batch) => batch.culprit !== null)?.culprit;
  const fromCards = ctx.state.cards.at(-1)?.against[0];
  return fromTickets ?? fromBisect ?? fromCards ?? undefined;
}

async function promotionPane(ctx: PlanContext, files: readonly string[]): Promise<MainPane> {
  const diff = await ctx.source.repoDiff(
    ctx.run,
    'stalk',
    'sprout',
    files.length === 0 ? undefined : files,
  );
  if (diff.files.length === 0)
    return empty('Waiting for the stalk', 'The stalk has everything on the sprout.');
  return {
    kind: 'diff',
    title: 'On the sprout, not on the stalk',
    diff: inAnswerOrder(diff, files),
    fromLabel: 'stalk',
    toLabel: 'sprout',
  };
}

/** The newest card's tests: the spec that won is what they now assert. */
async function decisionPane(ctx: PlanContext): Promise<MainPane> {
  const card = ctx.decisions.at(-1);
  if (card === undefined) return empty('Decisions', 'No decision card was raised in this run.');
  const test = card.failing.map(testPathOf).find((path) => ctx.treePaths.has(path));
  if (test !== undefined) return filePane(ctx, test, { blame: false });
  return card.winner === null ? beanPane(ctx, card.task) : beanPane(ctx, card.winner);
}

function agentPane(ctx: PlanContext): MainPane {
  const agent = ctx.spec.entities.agent;
  if (agent === null) return empty('Agent activity', 'Name an agent slot, like a3.');
  const beans = agentBeans(ctx, agent);
  return beans.length === 0
    ? empty(`Agent ${agent}`, `${agent} has not worked on a bean yet.`)
    : { kind: 'beans', title: `Beans ${agent} worked on`, beans };
}

function explorePane(ctx: PlanContext, set: FileSet): Promise<MainPane> {
  const pick =
    set.files[0] ?? (ctx.treePaths.has('README.md') ? 'README.md' : ctx.tree.files[0]?.path);
  if (pick === undefined) return Promise.resolve(empty('Repository', 'The repository is empty.'));
  return filePane(ctx, pick, { blame: false, searchHits: ctx.spec.entities.feature !== null });
}
