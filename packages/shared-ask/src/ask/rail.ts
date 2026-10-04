/**
 * The context rail: beans on the answer's files as a timeline with their agents, decision
 * records, the tests that cover the files, the agents' lanes, red runs and repairs, and
 * what waits for the stalk. Which blocks show is the catalog's choice for the class.
 */
import type { TaskId } from '@beanstalk/shared-race/ids';

import { beansTouching } from '../forge/bean-records';
import type { BeanRecord } from '../forge/forge-source';
import type { RailBlock, RedCheck, RedRun } from './answer';
import type { FileSet } from './file-set';
import { agentBeans, inFlightBeans } from './file-set';
import type { PlanContext } from './plan-context';
import type { RailSection } from './view-spec';
import { CATALOG } from './view-spec';

/** Beans listed in a rail timeline. */
const RAIL_BEANS = 24;

export async function railFor(ctx: PlanContext, set: FileSet): Promise<readonly RailBlock[]> {
  const blocks = await Promise.all(
    CATALOG[ctx.spec.class].view.rail.map((section) => railBlock(ctx, set, section)),
  );
  return blocks.flat();
}

async function railBlock(
  ctx: PlanContext,
  set: FileSet,
  section: RailSection,
): Promise<readonly RailBlock[]> {
  switch (section) {
    case 'beans':
      return [beansBlock(ctx, set)];
    case 'decisions':
      return [{ kind: 'decisions', cards: decisionsOn(ctx, set.files) }];
    case 'tests':
      return [{ kind: 'tests', tests: await testsOn(ctx, set) }];
    case 'agents':
      return [agentsBlock(ctx, set)];
    case 'red':
      return [redBlock(ctx)];
    case 'promotion':
      return [promotionBlock(ctx)];
    case 'checks':
      return checksBlock(ctx);
    default:
      return assertNever(section);
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected rail section ${String(value)}`);
}

function beansBlock(ctx: PlanContext, set: FileSet): RailBlock {
  const agent = ctx.spec.entities.agent;
  if (ctx.spec.class === 'agent-activity' && agent !== null) {
    return { kind: 'beans', title: `${agent}'s beans`, beans: agentBeans(ctx, agent) };
  }
  if (set.files.length === 0) {
    return { kind: 'beans', title: 'Recent beans', beans: active(ctx.beans).slice(0, RAIL_BEANS) };
  }
  return {
    kind: 'beans',
    title: 'Beans on these files',
    beans: byRelevance(set, active(beansTouching(ctx.beans, set.files))).slice(0, RAIL_BEANS),
  };
}

/** Beans the resolver credited first, then those touching more of the files, newest first. */
function byRelevance(set: FileSet, beans: readonly BeanRecord[]): readonly BeanRecord[] {
  const credited = new Set(set.ranked.flatMap((file) => file.beans));
  const wanted = new Set(set.files);
  const shared = (bean: BeanRecord) => bean.files.filter((file) => wanted.has(file)).length;
  return beans
    .map((bean, order) => ({ bean, order }))
    .toSorted(
      (a, b) =>
        Number(credited.has(b.bean.id)) - Number(credited.has(a.bean.id)) ||
        shared(b.bean) - shared(a.bean) ||
        a.order - b.order,
    )
    .map(({ bean }) => bean);
}

/** Beans that did something: started, landed or dropped (pending ones say nothing yet). */
function active(beans: readonly BeanRecord[]): readonly BeanRecord[] {
  return beans.filter((bean) => bean.status !== 'pending');
}

function decisionsOn(ctx: PlanContext, files: readonly string[]) {
  if (files.length === 0 || ctx.spec.class === 'decisions') return ctx.decisions;
  const wanted = new Set(files);
  return ctx.decisions.filter((card) => card.files.some((file) => wanted.has(file)));
}

/** Tests listed in the rail: failing ones first, then the module's own, at most this many. */
const RAIL_TESTS = 20;

/** The tests of the answer's files: those in the set, else those covering its code. */
async function testsOn(ctx: PlanContext, set: FileSet) {
  if (set.files.length === 0) return [];
  const tests = await ctx.source.testsFor(ctx.run, set.files);
  const inSet = new Set(set.files);
  const listed = tests.some((test) => inSet.has(test.path))
    ? tests.filter((test) => inSet.has(test.path))
    : tests;
  return listed
    .toSorted(
      (a, b) =>
        Number(b.state === 'fail') - Number(a.state === 'fail') ||
        Number(b.owner !== null) - Number(a.owner !== null),
    )
    .slice(0, RAIL_TESTS);
}

function agentsBlock(ctx: PlanContext, set: FileSet): RailBlock {
  const agent = ctx.spec.entities.agent;
  const wanted = new Set(set.files);
  const holders = new Set<TaskId>(
    inFlightBeans(ctx)
      .filter((bean) => set.files.length === 0 || bean.files.some((file) => wanted.has(file)))
      .map((bean) => bean.id),
  );
  const lanes = ctx.state.lanes.filter((lane) =>
    agent === null ? lane.bean !== null && holders.has(lane.bean) : lane.slot === agent,
  );
  return { kind: 'agents', lanes, now: ctx.now };
}

function redBlock(ctx: PlanContext): RailBlock {
  const since = ctx.range.since ?? 0;
  const runs: RedRun[] = ctx.state.ci
    .filter(
      (run) =>
        run.purpose !== 'final' &&
        run.green === false &&
        run.endedAt !== null &&
        run.endedAt >= since,
    )
    .map((run) => ({
      ci: run.ci,
      t: run.endedAt ?? run.startedAt,
      purpose: run.purpose,
      subject: run.trunkIdx === null ? (run.batch ?? run.ci) : `sprout #${run.trunkIdx}`,
      failingFiles: run.failingFiles,
      failingTests: run.failingTests,
    }));
  const checks: RedCheck[] = ctx.events.flatMap((event) =>
    event.type === 'preland.check' && !event.green && event.t >= since
      ? [{ bean: event.task, t: event.t, detail: event.failing_tests.slice(0, 3).join('\n') }]
      : [],
  );
  return {
    kind: 'red',
    runs: runs.toReversed(),
    checks: checks.toReversed(),
    tickets: ctx.state.tickets.map((ticket) => ({
      ticket: ticket.ticket,
      redIdx: ticket.redIdx,
      status: ticket.status,
      culprit: ticket.culprit,
      failing: ticket.failing,
    })),
    culprits: ctx.state.batches.flatMap((batch) =>
      batch.culprit === null
        ? []
        : [{ batch: batch.batch, culprit: batch.culprit, t: batch.startedAt }],
    ),
  };
}

function promotionBlock(ctx: PlanContext): RailBlock {
  const validating = ctx.state.ci.findLast(
    (run) => run.purpose === 'validate' && run.endedAt === null,
  );
  return {
    kind: 'promotion',
    beans: ctx.beans.filter((bean) => bean.status === 'landed'),
    validating:
      validating === undefined
        ? null
        : { idx: validating.trunkIdx, startedAt: validating.startedAt },
    ciSeconds: ctx.state.meta?.ciSeconds ?? 0,
    now: ctx.now,
  };
}

function checksBlock(ctx: PlanContext): readonly RailBlock[] {
  const id = ctx.selection.bean ?? ctx.spec.entities.bean;
  if (id === null) return [];
  const bean = ctx.state.beans[id];
  return bean === undefined ? [] : [{ kind: 'checks', bean: bean.id, steps: bean.steps }];
}
