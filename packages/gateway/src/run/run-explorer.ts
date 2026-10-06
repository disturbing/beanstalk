/**
 * The web app's views of beans and decisions (`beansByPath`, `beanDetail`, `decisions`),
 * built from the run's event log and the engine state. Events are read back loosely: only
 * the fields these views need, each checked for its type.
 */
import type {
  BeanCheck,
  BeanDetail,
  BeanInvocation,
  BeanRework,
  BeanSummary,
  DecisionRecord,
} from '@beanstalk/shared-race/rpc';

import { isUnder } from '../adapters/artifacts';
import type { EngineEnv } from '../engine/catalog';
import { effectiveTests } from '../engine/context';
import type { EngineState } from '../engine/state';
import { taskBranch } from '../engine/tasks';

/** The event types these views read (the RunDO selects only these). */
export const EXPLORER_EVENT_TYPES: readonly string[] = [
  'task.start',
  'task.commit',
  'land',
  'task.drop',
  'task.parked',
  'invocation.start',
  'invocation.end',
  'preland.check',
  'rework.start',
  'decision.request',
  'decision.made',
  'spec.amended',
];

/** Beans `beansByPath` returns at most. */
const MAX_BEANS = 200;

type Fields = Readonly<Record<string, unknown>>;

/** An event as stored: its envelope, then its fields unchecked. */
export type LoggedEvent = {
  readonly seq: number;
  readonly t: number;
  readonly type: string;
  readonly fields: Fields;
};

/** Parses a stored event body; null if it is not an event. */
export function parseLogged(body: string): LoggedEvent | null {
  const value: unknown = JSON.parse(body);
  if (!isFields(value)) return null;
  const { seq, t, type } = value;
  if (typeof seq !== 'number' || typeof t !== 'number' || typeof type !== 'string') return null;
  return { seq, t, type, fields: value };
}

export type ExplorerInput = {
  readonly state: EngineState;
  readonly env: EngineEnv;
  readonly events: readonly LoggedEvent[];
};

/** Beans whose files lie under `paths` (every bean when `paths` is empty), in task order. */
export function beanSummaries(input: ExplorerInput, paths: readonly string[]): BeanSummary[] {
  const files = beanFiles(input);
  const cards = cardsByBean(input.events);
  return input.state.order
    .map((id) => summary(input, { id, files: files.get(id) ?? [], cards: cards.get(id) ?? [] }))
    .filter((bean) => paths.length === 0 || bean.files.some((path) => isUnder(path, paths)))
    .slice(0, MAX_BEANS);
}

/** One bean's whole story; null for a task the run does not have. */
export function beanDetail(input: ExplorerInput, bean: string): BeanDetail | null {
  const task = input.state.tasks[bean];
  const definition = input.env.tasks.get(bean);
  if (task === undefined || definition === undefined) return null;
  const files = beanFiles(input);
  const mine = input.events.filter((event) => event.fields['task'] === bean);
  const amendedTests = input.state.amendedTests[bean] ?? {};
  return {
    ...summary(input, {
      id: bean,
      files: files.get(bean) ?? [],
      cards: cardsByBean(input.events).get(bean) ?? [],
    }),
    intent: definition.prompt,
    base_sha: task.baseSha,
    started_at: task.startedAt,
    landed_at: task.landedAt,
    green_at: task.greenAt,
    drop_reason: task.dropReason,
    acceptance: Object.keys(effectiveTests(input.env, input.state, bean)).map((path) => ({
      path,
      amended: Object.hasOwn(amendedTests, path),
    })),
    invocations: invocationsOf(input.events, bean),
    checks: mine.filter((event) => event.type === 'preland.check').map(toCheck),
    reworks: mine.filter((event) => event.type === 'rework.start').map(toRework),
    decisions: decisionRecords(input, null).filter(
      (record) => record.task === bean || record.against.includes(bean),
    ),
  };
}

/** Decision cards, optionally only those whose beans or amendments touch `paths`. */
export function decisionRecords(
  input: ExplorerInput,
  paths: readonly string[] | null,
): DecisionRecord[] {
  const files = beanFiles(input);
  const records = new Map<string, DecisionRecord>();
  for (const event of input.events) {
    const card = text(event.fields, 'card');
    if (card === null) continue;
    const current = records.get(card);
    if (event.type === 'decision.request') records.set(card, requested(event, card));
    else if (event.type === 'decision.made' && current !== undefined) {
      records.set(card, decided(current, event));
    } else if (event.type === 'spec.amended' && current !== undefined) {
      records.set(card, amended(current, event));
    }
  }
  const found: DecisionRecord[] = [];
  for (const record of records.values()) {
    const touched = cardFiles(record, files);
    if (paths === null || touched.some((path) => isUnder(path, paths))) {
      found.push({ ...record, files: touched });
    }
  }
  return found;
}

function summary(
  input: ExplorerInput,
  bean: { id: string; files: readonly string[]; cards: readonly string[] },
): BeanSummary {
  const task = input.state.tasks[bean.id];
  return {
    bean: bean.id,
    branch: taskBranch(bean.id),
    title: input.env.tasks.get(bean.id)?.title ?? bean.id,
    status: task?.status ?? 'pending',
    agent: task?.agent ?? null,
    files: [...bean.files],
    head_sha: task?.headSha ?? null,
    landed_sha: task?.landedSha ?? null,
    cards: [...bean.cards],
    intent: input.env.tasks.get(bean.id)?.prompt ?? '',
  };
}

/** Each bean's files: its landing's, else its last commit's, plus its acceptance tests. */
function beanFiles(input: ExplorerInput): Map<string, string[]> {
  const committed = new Map<string, readonly string[]>();
  const landed = new Map<string, readonly string[]>();
  for (const event of input.events) {
    const task = text(event.fields, 'task');
    if (task === null) continue;
    if (event.type === 'task.commit') committed.set(task, strings(event.fields, 'files'));
    if (event.type === 'land') landed.set(task, strings(event.fields, 'files'));
  }
  const files = new Map<string, string[]>();
  for (const id of input.state.order) {
    const own = Object.keys(effectiveTests(input.env, input.state, id));
    const changed = landed.get(id) ?? committed.get(id) ?? [];
    files.set(id, [...new Set([...changed, ...(changed.length > 0 ? own : [])])].toSorted());
  }
  return files;
}

function cardsByBean(events: readonly LoggedEvent[]): Map<string, string[]> {
  const cards = new Map<string, string[]>();
  for (const event of events) {
    if (event.type !== 'decision.request') continue;
    const card = text(event.fields, 'card');
    if (card === null) continue;
    const beans = [text(event.fields, 'task'), ...strings(event.fields, 'against')];
    for (const bean of beans) {
      if (bean !== null) cards.set(bean, [...(cards.get(bean) ?? []), card]);
    }
  }
  return cards;
}

function invocationsOf(events: readonly LoggedEvent[], bean: string): BeanInvocation[] {
  const invocations = new Map<string, BeanInvocation>();
  for (const event of events) {
    const inv = text(event.fields, 'inv');
    if (inv === null || event.fields['task'] !== bean) continue;
    if (event.type === 'invocation.start') {
      invocations.set(inv, {
        inv,
        kind: text(event.fields, 'kind') ?? '?',
        agent: text(event.fields, 'agent'),
        started_t: event.t,
        ended_t: null,
        ok: null,
        cost_usd: null,
      });
    }
    const started = invocations.get(inv);
    if (event.type === 'invocation.end' && started !== undefined) {
      const ok = event.fields['ok'];
      invocations.set(inv, {
        ...started,
        ended_t: event.t,
        ok: typeof ok === 'boolean' ? ok : null,
        cost_usd: number(event.fields, 'cost_usd'),
      });
    }
  }
  return [...invocations.values()];
}

function toCheck(event: LoggedEvent): BeanCheck {
  const failing = event.fields['failing_files'];
  return {
    t: event.t,
    sha: text(event.fields, 'sha') ?? '',
    green: event.fields['green'] === true,
    failing_files: Array.isArray(failing) ? strings(event.fields, 'failing_files') : null,
    inherited: event.fields['inherited'] === true,
  };
}

function toRework(event: LoggedEvent): BeanRework {
  return {
    t: event.t,
    reason: text(event.fields, 'reason') ?? '?',
    attempt: number(event.fields, 'attempt') ?? 0,
    resumed: event.fields['resumed'] === true,
    culprits: strings(event.fields, 'culprits'),
    card: text(event.fields, 'card'),
  };
}

function requested(event: LoggedEvent, card: string): DecisionRecord {
  const specs = event.fields['specs'];
  return {
    card,
    task: text(event.fields, 'task') ?? '?',
    against: strings(event.fields, 'against'),
    specs: isFields(specs)
      ? Object.fromEntries(
          Object.entries(specs).flatMap(([key, value]) =>
            typeof value === 'string' ? [[key, value]] : [],
          ),
        )
      : {},
    failing: strings(event.fields, 'failing'),
    attempts: number(event.fields, 'attempts') ?? 0,
    status: 'open',
    winner: null,
    loser: null,
    outcome: null,
    text: null,
    by: null,
    opened_t: event.t,
    decided_t: null,
    amendment: null,
    files: [],
  };
}

function decided(record: DecisionRecord, event: LoggedEvent): DecisionRecord {
  const outcome = text(event.fields, 'outcome');
  return {
    ...record,
    status: outcome === null ? 'done' : 'decided',
    winner: text(event.fields, 'winner'),
    loser: text(event.fields, 'loser'),
    outcome: outcome === 'keep-landed' || outcome === 'adopt-in-place' ? outcome : 'declined',
    text: text(event.fields, 'text'),
    by: answeredBy(text(event.fields, 'oracle')),
    decided_t: event.t,
  };
}

/** `decision.made`'s `oracle` field as a `by`: `oracle:<name>`, `human:<actor>`, `timeout:<name>`. */
function answeredBy(oracle: string | null): string | null {
  if (oracle === null) return null;
  if (oracle === 'admin') return 'human:admin';
  return oracle.includes(':') ? oracle : `oracle:${oracle}`;
}

function amended(record: DecisionRecord, event: LoggedEvent): DecisionRecord {
  const status = text(event.fields, 'status');
  const isKnown =
    status === 'amended' || status === 'none' || status === 'rejected' || status === 'rolled-back';
  return {
    ...record,
    status: 'done',
    amendment: isKnown ? { status, paths: strings(event.fields, 'paths') } : record.amendment,
  };
}

function cardFiles(record: DecisionRecord, files: ReadonlyMap<string, string[]>): string[] {
  const beans = [record.task, ...record.against];
  return [
    ...new Set([
      ...beans.flatMap((bean) => files.get(bean) ?? []),
      ...(record.amendment?.paths ?? []),
    ]),
  ].toSorted();
}

function isFields(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(fields: Fields, key: string): string | null {
  const value = fields[key];
  return typeof value === 'string' ? value : null;
}

function number(fields: Fields, key: string): number | null {
  const value = fields[key];
  return typeof value === 'number' ? value : null;
}

function strings(fields: Fields, key: string): string[] {
  const value = fields[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}
