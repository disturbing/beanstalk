import { createTwoFilesPatch } from 'diff';
import { describe, expect, it } from 'vitest';

import { RunId, TaskId } from '@beanstalk/shared-race/ids';
import type { GatewayRpc, RepoDiff, RpcResult } from '@beanstalk/shared-race/rpc';

import { CardId } from '@beanstalk/shared-ask/race/race-events';
import { recordedRun } from '../recorded/recorded-runs';
import { isForgeError } from '@beanstalk/shared-ask/forge/forge-errors';
import type { GatewayBinding } from '@beanstalk/shared-ask/forge/gateway-rpc';
import { asGatewayBinding } from '@beanstalk/shared-ask/forge/gateway-rpc';
import { gatewaySource } from '@beanstalk/shared-ask/forge/gateway-source';

const run = RunId.parse('j6boaclinn');
const recorded = requireRecorded();
const landed = recorded.repo.line;
const firstLanding = requireFirstLanding();

function requireRecorded() {
  const found = recordedRun(run);
  if (found === undefined) throw new Error('the v2.5 fixture is missing');
  return found;
}

function requireFirstLanding() {
  const first = requireRecorded().repo.line[0];
  if (first === undefined) throw new Error('the v2.5 fixture has no landing');
  return first;
}

function ok<T>(value: T): Promise<RpcResult<T>> {
  return Promise.resolve({ ok: true, value });
}

function missing(): Promise<RpcResult<never>> {
  return Promise.resolve({
    ok: false,
    error: { code: 'not_found', status: 404, message: 'no such thing' },
  });
}

const TREE_ROOT = [
  { name: 'README.md', path: 'README.md', type: 'blob' as const, sha: 'a'.repeat(40) },
  { name: 'src', path: 'src', type: 'tree' as const, sha: 'b'.repeat(40) },
];
const TREE_SRC = [
  { name: 'app.ts', path: 'src/app.ts', type: 'blob' as const, sha: 'c'.repeat(40) },
];

function treeLevel(path: string) {
  return path === '' ? TREE_ROOT : TREE_SRC;
}

/** A gateway binding answering from the recorded run, in the RPC's shapes. */
function fakeBinding(overrides: Partial<GatewayRpc> = {}): GatewayBinding<Fetcher> {
  const rpc: GatewayRpc = {
    listRuns: () =>
      Promise.resolve([
        {
          run: 'k3x9q2m7ab',
          policy: 'beanstalk-v2',
          phase: 'running',
          aborted: null,
          created_at: '2026-10-04T10:00:00.000Z',
          updated_at: '2026-10-04T10:05:00.000Z',
          agents: 12,
          tasks: {
            pending: 0,
            running: 4,
            queued: 0,
            testing: 0,
            rework: 1,
            landed: 2,
            green: 9,
            dropped: 0,
            total: 16,
          },
          spent_usd: 1.25,
          preset: null,
        },
      ]),
    runView: () => missing(),
    runEvents: (_run, after, limit) => {
      const events = recorded.events.filter((event) => event.seq > after).slice(0, limit);
      return ok({
        events: events.map((event) => JSON.stringify(event)),
        next_after: events.at(-1)?.seq ?? after,
        done: events.length < limit,
      });
    },
    decide: () =>
      Promise.resolve({
        ok: false,
        error: { code: 'unknown_card', status: 404, message: 'card D009 is not open' },
      }),
    viewToken: () => missing(),
    repoTree: (_run, ref, path = '', recursive = false) => {
      const entries = recursive ? [...TREE_ROOT, ...TREE_SRC] : treeLevel(path);
      return ok({ ref, commit: firstLanding.sha, path, entries, truncated: false });
    },
    repoFile: () => missing(),
    repoDiff: (_run, fromRef, toRef) =>
      ok({
        from: { ref: fromRef, commit: firstLanding.parent },
        to: { ref: toRef, commit: firstLanding.sha },
        files: [
          { path: 'src/lib/money.ts', status: 'modified' as const, additions: 1, deletions: 1 },
        ],
        patch: createTwoFilesPatch(
          'a/src/lib/money.ts',
          'b/src/lib/money.ts',
          'one\ntwo\nthree\n',
          'one\nTWO\nthree\n',
        ),
        truncated: false,
      }),
    repoLog: (_run, ref) =>
      ok({
        ref,
        commits: [
          ...landed
            .slice(0, 3)
            .toReversed()
            .map((commit) => ({
              sha: commit.sha,
              parents: [commit.parent],
              message: `title of ${commit.task ?? ''}\n\nTask: ${commit.task ?? ''}\n`,
              author: { name: 'beanstalk-runner', email: 'runner@beanstalk.invalid' },
              committed_at: '2026-10-03T15:35:36.000Z',
            })),
          {
            sha: recorded.repo.base,
            parents: [],
            message: 'Beanstalk Shop: base application',
            author: { name: 'arena', email: 'arena@example.invalid' },
            committed_at: '2026-10-01T00:00:00.000Z',
          },
        ],
        scanned: 4,
        truncated: false,
      }),
    repoGrep: () =>
      ok({
        ref: 'sprout',
        commit: firstLanding.sha,
        pattern: '',
        matches: [],
        files_scanned: 0,
        truncated: false,
      }),
    beansByPath: () =>
      ok([
        {
          bean: 't005',
          branch: 'beans/t005',
          title: 'Show thousands separators in displayed amounts',
          status: 'green' as const,
          agent: 'a0',
          files: ['src/lib/money.ts'],
          head_sha: null,
          landed_sha: landed[1]?.sha ?? null,
          cards: ['D001'],
        },
      ]),
    beanDetail: () => missing(),
    decisions: () => ok([]),
    testsFor: () => ok([]),
    verifyViewToken: () => missing(),
    ...overrides,
  };
  return {
    ...rpc,
    fetch: () => Promise.resolve(new Response('not used', { status: 404 })),
    connect: () => {
      throw new Error('the fake binding has no sockets');
    },
  };
}

describe('the gateway adapter', () => {
  const source = gatewaySource(fakeBinding());

  it('reads the event log page by page and parses it', async () => {
    const page = await source.runEvents(run, 0, 100);
    expect(page.events).toHaveLength(100);
    expect(page.done).toBe(false);
    const rest = await source.runEvents(run, page.nextAfter, 5000);
    expect(page.events.length + rest.events.length).toBe(recorded.events.length);
  });

  it('walks the tree one directory level at a time', async () => {
    const tree = await source.repoTree(run, 'sprout');
    expect(tree.files.map((file) => file.path)).toEqual(['README.md', 'src/app.ts']);
  });

  it('walks the tree level by level when the whole tree comes back truncated', async () => {
    const calls: string[] = [];
    const truncating = gatewaySource(
      fakeBinding({
        repoTree: (_run, ref, path = '', recursive = false) => {
          calls.push(recursive ? 'whole' : `level:${path}`);
          if (recursive)
            return ok({ ref, commit: firstLanding.sha, path, entries: [], truncated: true });
          return ok({
            ref,
            commit: firstLanding.sha,
            path,
            entries: treeLevel(path),
            truncated: false,
          });
        },
      }),
    );
    const tree = await truncating.repoTree(run, 'sprout');
    expect(tree.files.map((file) => file.path)).toEqual(['README.md', 'src/app.ts']);
    expect(calls).toEqual(['whole', 'level:', 'level:src']);
  });

  it('turns the patch text into hunks with line numbers', async () => {
    const diff = await source.repoDiff(run, 'stalk', 'sprout');
    const lines = diff.files[0]?.hunks[0]?.lines ?? [];
    expect(lines.map((line) => [line.kind, line.text, line.oldNo, line.newNo])).toEqual([
      ['context', 'one', 1, 1],
      ['del', 'two', 2, null],
      ['add', 'TWO', null, 2],
      ['context', 'three', 3, 3],
    ]);
  });

  it('keeps only line commits in a log, with their bean, position and race time', async () => {
    const log = await source.repoLog(run, 'sprout');
    expect(log.map((commit) => [commit.task, commit.idx])).toEqual([
      ['t008', 2],
      ['t005', 1],
      ['t012', 0],
    ]);
    expect(log.at(-1)?.t).toBe(firstLanding.t);
  });

  it('adds the phase and timings from the event log to each bean', async () => {
    const [bean] = await source.beansByPath(run, ['src/lib/money.ts']);
    expect(bean).toMatchObject({ id: 't005', status: 'green', agent: 'a0', landedIdx: 1 });
    expect(bean?.greenAt).not.toBeNull();
  });

  it('reports a missing bean as undefined and a refused decision as a value', async () => {
    expect(await source.beanDetail(run, TaskId.parse('t099'))).toBeUndefined();
    expect(
      await source.decide(run, CardId.parse('D009'), {
        winner: TaskId.parse('t005'),
        actor: 'test',
      }),
    ).toEqual({
      ok: false,
      code: 'unknown_card',
      message: 'card D009 is not open',
    });
  });

  it('reads the v2.2 agent release from the run view', async () => {
    const releasing = gatewaySource(
      fakeBinding({
        runView: () =>
          Promise.resolve(
            JSON.parse(
              '{"ok":true,"value":{"policy_state":{"kind":"beanstalk-v2","settings":{"release_on_check":true}}}}',
            ),
          ),
      }),
    );
    expect(await releasing.runOptions(run)).toEqual({ releaseOnCheck: true });
  });

  it('lists live runs from the index', async () => {
    const [listed] = await source.listRuns();
    expect(listed).toMatchObject({
      run: 'k3x9q2m7ab',
      source: 'live',
      phase: 'running',
      beans: 16,
      green: 9,
    });
  });

  it('turns a gateway refusal into a typed error and a bad answer into another', async () => {
    // The gateway is another Worker: its answers are untyped JSON until validated.
    const nonsense: Promise<RpcResult<RepoDiff>> = Promise.resolve(
      JSON.parse('{"ok":true,"value":{"nonsense":true}}'),
    );
    const broken = gatewaySource(fakeBinding({ repoDiff: () => nonsense }));
    await expect(broken.repoDiff(run, 'stalk', 'sprout')).rejects.toSatisfy((error: unknown) =>
      isForgeError(error, 'bad_response'),
    );
    const refusing = gatewaySource(fakeBinding({ repoTree: () => missing() }));
    await expect(refusing.repoTree(run, 'sprout')).rejects.toSatisfy((error: unknown) =>
      isForgeError(error, 'not_found'),
    );
  });
});

describe('narrowing the binding', () => {
  it('accepts a binding that exposes the RPC methods', () => {
    expect(asGatewayBinding(fakeBinding())).toBeDefined();
  });
});
