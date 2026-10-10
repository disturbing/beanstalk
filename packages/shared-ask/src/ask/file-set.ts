/**
 * The files an answer is about: the entities' files (a resolved feature, named paths, a
 * bean, an agent), narrowed by what the question class looks at (changes in the range,
 * work in flight, red tests, the stalk-to-sprout gap, decisions, tests).
 */
import type { TaskId } from '@gitstalk/shared-race/ids';

import type { PickReceipt } from '../pick/picker';

import { isInFlight } from '../race/race-counters';
import { isTestFile } from '../repo/imports';
import { compareText } from '../repo/paths';
import { pickFiles } from './answer-picks';
import { loadCorpus } from './corpus';
import type { PlanContext } from './plan-context';
import { filesChanged } from './plan-context';
import type { RankedFile } from './resolve-files';
import { resolveFiles } from './resolve-files';

export type FileSet = {
  readonly files: readonly string[];
  /** The resolver's ranking when a feature was asked (drives chips and badges). */
  readonly ranked: readonly RankedFile[];
  /** Set when the class found nothing in the entities' files and fell back to them. */
  readonly widened: boolean;
  /** The picker's choice among the resolver's files, when there was one to make. */
  readonly receipt: PickReceipt | null;
};

export async function fileSetFor(ctx: PlanContext): Promise<FileSet> {
  const picked = await pickedFeatureFiles(ctx);
  const set = await fileSetFrom(ctx, picked.ranked);
  return { ...set, receipt: picked.receipt };
}

async function pickedFeatureFiles(ctx: PlanContext) {
  const ranked = await rankFeature(ctx);
  const feature = ctx.spec.entities.feature;
  if (feature === null) return { ranked, receipt: null };
  return pickFiles({ picker: ctx.picker, feature, ranked });
}

async function fileSetFrom(
  ctx: PlanContext,
  ranked: readonly RankedFile[],
): Promise<Omit<FileSet, 'receipt'>> {
  if (ctx.spec.class === 'tests-for') return testFileSet(ctx, ranked);
  const entity = entityFiles(ctx, ranked);
  const scope = await classScope(ctx);
  if (scope === undefined) return { files: entity ?? [], ranked, widened: false };
  if (entity === undefined) return { files: sorted(scope), ranked, widened: false };
  const both = entity.filter((path) => scope.has(path));
  return both.length > 0
    ? { files: both, ranked, widened: false }
    : { files: entity, ranked, widened: true };
}

async function rankFeature(ctx: PlanContext): Promise<readonly RankedFile[]> {
  const feature = ctx.spec.entities.feature;
  if (feature === null) return [];
  const corpus = await loadCorpus(ctx.source, { run: ctx.run, ref: ctx.refName }, feature);
  return resolveFiles(feature, corpus).filter((file) => !ctx.removals.files.has(file.path));
}

/** The intersection of every entity the question names; undefined when it names none. */
function entityFiles(
  ctx: PlanContext,
  ranked: readonly RankedFile[],
): readonly string[] | undefined {
  const { entities } = ctx.spec;
  const sets: (readonly string[])[] = [];
  if (entities.feature !== null) sets.push(ranked.map((file) => file.path));
  if (entities.paths.length > 0) sets.push(underPaths(ctx, entities.paths));
  if (entities.bean !== null) sets.push(ctx.beanById.get(entities.bean)?.files ?? []);
  if (entities.agent !== null) sets.push(agentFiles(ctx, entities.agent));
  const first = sets[0];
  if (first === undefined) return undefined;
  const common = first.filter((path) => sets.every((set) => set.includes(path)));
  return common.length > 0 ? common : [...new Set(sets.flat())];
}

function underPaths(ctx: PlanContext, prefixes: readonly string[]): readonly string[] {
  return [...ctx.treePaths].filter((path) =>
    prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix.replace(/\/$/, '')}/`)),
  );
}

export function agentBeans(ctx: PlanContext, agent: string) {
  return ctx.beans.filter((bean) => bean.agent === agent);
}

function agentFiles(ctx: PlanContext, agent: string): readonly string[] {
  return [...new Set(agentBeans(ctx, agent).flatMap((bean) => bean.files))];
}

/** What the class looks at; undefined when it looks at whatever the entities name. */
function classScope(
  ctx: PlanContext,
): Promise<ReadonlySet<string> | undefined> | ReadonlySet<string> | undefined {
  switch (ctx.spec.class) {
    case 'recent-changes':
    case 'who-why':
      return filesChanged(ctx.range.commits);
    case 'in-flight':
      return new Set(inFlightBeans(ctx).flatMap((bean) => bean.files));
    case 'what-broke':
      return redFiles(ctx);
    case 'pending-promotion':
      return filesChanged(unpromoted(ctx));
    case 'decisions':
      return new Set(ctx.decisions.flatMap((card) => card.files));
    case 'tests-for':
    case 'agent-activity':
    case 'bean':
    case 'explore':
      return undefined;
    default:
      return assertNever(ctx.spec.class);
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected class ${String(value)}`);
}

export function inFlightBeans(ctx: PlanContext) {
  return ctx.beans.filter((bean) => isInFlight(bean.phase));
}

/** Line commits on the sprout that the stalk does not have yet. */
export function unpromoted(ctx: PlanContext) {
  const stalkIdx = ctx.state.line.stalkIdx;
  return ctx.log.filter((commit) => commit.idx !== null && commit.idx > stalkIdx);
}

/**
 * What broke the line: the tests that failed its validations (or the queue's batches) and
 * the files of the beans blamed for them. Red pre-land checks are the system working; they
 * show in the rail, not here.
 */
function redFiles(ctx: PlanContext): ReadonlySet<string> {
  const culpritFiles = culprits(ctx).flatMap((id) => ctx.beanById.get(id)?.files ?? []);
  const failing = lineFailures(ctx);
  return new Set([...failing, ...culpritFiles].filter((path) => ctx.treePaths.has(path)));
}

/** Beans blamed for red validations: repair tickets and queue bisections. */
export function culprits(ctx: PlanContext): readonly TaskId[] {
  return [
    ...new Set([
      ...ctx.state.tickets.flatMap((ticket) => (ticket.culprit === null ? [] : [ticket.culprit])),
      ...ctx.state.batches.flatMap((batch) => (batch.culprit === null ? [] : [batch.culprit])),
    ]),
  ];
}

/** Test files that failed a validation or a batch in the range. */
function lineFailures(ctx: PlanContext): readonly string[] {
  const since = ctx.range.since ?? 0;
  const failing = ctx.state.ci
    .filter(
      (run) =>
        run.purpose !== 'final' &&
        run.green === false &&
        run.endedAt !== null &&
        run.endedAt >= since,
    )
    .flatMap((run) => run.failingFiles);
  return [...new Set(failing)];
}

export function failingTestFiles(ctx: PlanContext): readonly string[] {
  const since = ctx.range.since ?? 0;
  const fromRuns = ctx.state.ci
    .filter(
      (run) =>
        run.purpose !== 'final' &&
        run.green === false &&
        run.endedAt !== null &&
        run.endedAt >= since,
    )
    .flatMap((run) => run.failingFiles);
  const fromChecks = ctx.events.flatMap((event) =>
    event.type === 'preland.check' && !event.green && event.t >= since
      ? event.failing_tests.map(testPathOf)
      : [],
  );
  const fromCards = ctx.state.cards.flatMap((card) => card.failing.map(testPathOf));
  return [...new Set([...fromRuns, ...fromChecks, ...fromCards])].toSorted(compareText);
}

/** `src/x.test.ts > name` → `src/x.test.ts`. */
export function testPathOf(failingTest: string): string {
  return failingTest.split(' > ')[0] ?? failingTest;
}

/**
 * Tests for the named code: the code the resolver matched by name or content, then the
 * tests it matched, then every test that imports that code or sits beside it.
 */
async function testFileSet(
  ctx: PlanContext,
  ranked: readonly RankedFile[],
): Promise<Omit<FileSet, 'receipt'>> {
  const named = entityFiles(ctx, ranked) ?? [];
  const code = named.filter(
    (path) =>
      !isTestFile(path) &&
      (ranked.length === 0 ||
        ranked.some(
          (file) =>
            file.path === path &&
            (file.reasons.includes('path') || file.reasons.includes('content')),
        )),
  );
  const rankedTests = named.filter(isTestFile);
  const covering = code.length === 0 ? [] : await ctx.source.testsFor(ctx.run, code);
  const tests = [
    ...new Set([...rankedTests, ...covering.map((test) => test.path).toSorted(compareText)]),
  ];
  return { files: [...code, ...tests], ranked, widened: false };
}

/** Code files first, tests after, each sorted: how a filtered tree reads best. */
function sorted(paths: ReadonlySet<string>): readonly string[] {
  return [...paths].toSorted(
    (a, b) => Number(isTestFile(a)) - Number(isTestFile(b)) || compareText(a, b),
  );
}
