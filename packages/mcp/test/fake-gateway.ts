/**
 * A fake GATEWAY answering the gateway's RPC from a recorded run (the web app's v2.5 fixture,
 * run j6boaclinn): its event log, its tasks and its repo snapshot. Answers come back in the
 * RPC's wire shapes, so the shared forge adapter validates them as it does live ones.
 */
import { z } from 'zod';

import { RunId } from '@beanstalk/shared-race/ids';
import type { GatewayRpc } from '@beanstalk/shared-race/rpc';

import type { GatewayBinding } from '@beanstalk/shared-ask/forge/gateway-rpc';
import { asGatewayBinding } from '@beanstalk/shared-ask/forge/gateway-rpc';
import { parseRaceEvents } from '@beanstalk/shared-ask/race/race-events';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';

import eventsText from '../../web/fixtures/j6boaclinn/events.jsonl?raw';
import repoText from '../../web/fixtures/j6boaclinn/repo.json?raw';
import tasksText from '../../web/fixtures/j6boaclinn/tasks.json?raw';

export const RUN = RunId.parse('j6boaclinn');
export const VIEW_TOKEN = 'bst1.view-token-for-the-recorded-run';
export const SLOT_TOKEN = 'bst1.slot-token-for-a1';
export const WINDOW_SIZE = 8;

const Tasks = z.array(
  z.object({ id: z.string(), title: z.string(), intent: z.string(), tests: z.array(z.string()) }),
);
const Repo = z.object({
  base: z.string(),
  paths: z.array(z.string()),
  blobs: z.array(z.string()),
  trees: z.record(z.string(), z.array(z.number().int())),
  line: z.array(z.object({ sha: z.string(), task: z.string().nullable() })),
});

const lines = eventsText.split('\n').filter((line) => line.trim() !== '');
const records = lines.map((line) => z.object({ seq: z.number() }).loose().parse(JSON.parse(line)));
const state = reduceRace(parseRaceEvents(records).events);
const tasks = new Map(Tasks.parse(JSON.parse(tasksText)).map((task) => [task.id, task]));
const repo = Repo.parse(JSON.parse(repoText));

type FakeMethod = (...args: readonly never[]) => Promise<unknown>;
type FakeRpc = Partial<Record<keyof GatewayRpc, FakeMethod>>;

/** The fake binding; `overrides` replace single methods. */
export function fakeGateway(overrides: Partial<FakeRpc> = {}): GatewayBinding<object> {
  const rpc: FakeRpc = {
    listRuns: () => Promise.resolve([]),
    runView: () => ok({ policy_state: { window: { size: WINDOW_SIZE, waiting: [] } } }),
    runEvents: (_run: string, after: number, limit: number) => ok(eventsPage(after, limit)),
    decide: () => missing('card'),
    viewToken: () => missing('run'),
    repoTree: (_run: string, ref: string) => ok(treeAt(ref)),
    repoFile: (_run: string, ref: string, path: string) => fileAt(ref, path),
    repoDiff: (_run: string, from: string, to: string) =>
      ok({
        from: { ref: from, commit: shaOf(from) },
        to: { ref: to, commit: shaOf(to) },
        files: [],
        patch: '',
        truncated: false,
      }),
    repoLog: () => ok({ commits: logCommits() }),
    repoGrep: (_run: string, ref: string, pattern: string) => ok({ matches: grep(ref, pattern) }),
    beansByPath: (_run: string, paths: readonly string[]) => ok(beansOn(paths)),
    beanDetail: (_run: string, bean: string) => beanDetail(bean),
    decisions: () => ok(decisions()),
    testsFor: () => ok([]),
    verifyViewToken: (token: string) => verify(token),
    beanStreams: () => ok([]),
    beanStream: () => ok(null),
    ...overrides,
  };
  const binding = asGatewayBinding(rpc);
  if (binding === undefined) throw new Error('the fake gateway lacks an RPC method');
  return binding;
}

function ok(value: unknown): Promise<unknown> {
  return Promise.resolve({ ok: true, value });
}

function missing(what: string): Promise<unknown> {
  return Promise.resolve({
    ok: false,
    error: { code: 'not_found', status: 404, message: `no such ${what}` },
  });
}

function verify(token: string): Promise<unknown> {
  if (token === VIEW_TOKEN)
    return ok({ run: RUN, sub: 'test', expires_at: '2026-10-11T00:00:00.000Z' });
  const error =
    token === SLOT_TOKEN
      ? { code: 'forbidden', status: 403, message: 'a slot token cannot read through this API' }
      : { code: 'unauthorized', status: 401, message: 'run token bad signature' };
  return Promise.resolve({ ok: false, error });
}

function eventsPage(after: number, limit: number) {
  const page = records
    .flatMap((record, index) =>
      record.seq > after ? [{ seq: record.seq, line: lines[index] ?? '' }] : [],
    )
    .slice(0, limit);
  return {
    events: page.map((entry) => entry.line),
    next_after: page.at(-1)?.seq ?? after,
    done: page.length < limit,
  };
}

/** `sprout` is the newest line commit, `stalk` the newest validated one; else a commit sha. */
function shaOf(ref: string): string {
  if (ref === 'sprout') return repo.line.at(-1)?.sha ?? repo.base;
  if (ref === 'stalk') return state.line.stalkSha ?? repo.base;
  return ref;
}

/** The snapshot's files at a ref, as path → blob index. */
function filesAt(ref: string): ReadonlyMap<string, number> {
  const pairs = repo.trees[shaOf(ref)] ?? [];
  const files = new Map<string, number>();
  for (let index = 0; index + 1 < pairs.length; index += 2) {
    const path = repo.paths[pairs[index] ?? -1];
    if (path !== undefined) files.set(path, pairs[index + 1] ?? -1);
  }
  return files;
}

function treeAt(ref: string) {
  const entries = [...filesAt(ref).keys()].map((path) => ({ path, type: 'blob' }));
  return { ref, commit: shaOf(ref), path: '', entries, truncated: false };
}

function fileAt(ref: string, path: string): Promise<unknown> {
  const blob = filesAt(ref).get(path);
  const content = blob === undefined ? undefined : repo.blobs[blob];
  if (content === undefined) return missing('file');
  return ok({
    ref,
    commit: shaOf(ref),
    path,
    size: content.length,
    binary: false,
    content,
    truncated: false,
  });
}

function logCommits() {
  const commits = repo.line.map((commit, index) => ({
    sha: commit.sha,
    parents: [repo.line[index - 1]?.sha ?? repo.base],
    message: `${tasks.get(commit.task ?? '')?.title ?? 'revert'}\n\nTask: ${commit.task ?? ''}\n`,
  }));
  return [...commits.toReversed(), { sha: repo.base, parents: [], message: 'base' }];
}

function grep(ref: string, pattern: string) {
  const matcher = new RegExp(pattern, 'i');
  return [...filesAt(ref)].flatMap(([path, blob]) =>
    (repo.blobs[blob] ?? '')
      .split('\n')
      .flatMap((text, index) => (matcher.test(text) ? [{ path, line: index + 1, text }] : [])),
  );
}

function beansOn(paths: readonly string[]) {
  return state.order.flatMap((id) => {
    const bean = state.beans[id];
    const task = tasks.get(id);
    if (bean === undefined || task === undefined) return [];
    const touches =
      paths.length === 0 ||
      bean.files.some((file) => paths.some((path) => file === path || file.startsWith(`${path}/`)));
    if (!touches) return [];
    return [
      {
        bean: id,
        branch: `beans/${id}`,
        title: task.title,
        intent: task.intent,
        files: bean.files,
      },
    ];
  });
}

function beanDetail(id: string): Promise<unknown> {
  const bean = state.beans[id];
  const task = tasks.get(id);
  if (bean === undefined || task === undefined) return missing('bean');
  return ok({
    bean: id,
    title: task.title,
    intent: task.intent,
    files: bean.files,
    head_sha: bean.head,
    base_sha: bean.base,
    landed_sha: bean.landedSha,
    acceptance: task.tests.map((path) => ({ path, amended: false })),
  });
}

function decisions() {
  return state.cards.map((card) => ({
    card: card.card,
    by: card.oracle,
    outcome: card.outcome,
    files: [card.task, ...card.against].flatMap((id) => state.beans[id]?.files ?? []),
  }));
}
