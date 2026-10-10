import { describe, expect, it } from 'vitest';

import { RunId } from '@gitstalk/shared-race/ids';

import { GREETER_PUSHED, ROOT, SLUGIFY_LANDED, TRUNCATE_LANDED } from '../changes/testing/greeter';
import events from '../changes/testing/greeter-events.json' with { type: 'json' };
import { codeData } from './code-data';
import { engineReads } from './engine-reads';

const ENGINE = RunId.parse('r281f4071a6a622cb597');
const SHOUT_HEAD = 'a8c8ab782a7c7281f05cb47a8b1722610ccb60d4';

/** Files of the stalk: many, so a call per file would show in the counts. */
const STALK_FILES = [
  'README.md',
  'package.json',
  ...Array.from({ length: 40 }, (_, index) => `src/module-${index}.ts`),
];

const ok = (value: unknown) => Promise.resolve({ ok: true, value });
const missing = () =>
  Promise.resolve({ ok: false, error: { code: 'not_found', status: 404, message: 'missing' } });

const commit = (sha: string, parents: string[], message: string) => ({
  sha,
  parents,
  message,
  author: { name: 'gitstalk-runner', email: 'runner@gitstalk.invalid' },
  committed_at: '2026-10-07T13:41:19Z',
});

/** The gateway binding as the web app sees it, answering for `coop/greeter`, counting calls. */
function fakeGateway() {
  const calls = new Map<string, number>();
  const count = (method: string) => calls.set(method, (calls.get(method) ?? 0) + 1);
  const answers: Record<string, (...args: never[]) => Promise<unknown>> = {
    listRuns: () => Promise.resolve([]),
    runView: () => ok({ policy_state: null }),
    runEvents: (_run: string, after: number) =>
      ok({
        events: after === 0 ? events.map((event) => JSON.stringify(event)) : [],
        next_after: events.length,
        done: false,
      }),
    decide: missing,
    viewToken: missing,
    repoTree: (_run: string, ref: string) =>
      ok({
        commit: /^[0-9a-f]{40}$/.test(ref) ? ref : SLUGIFY_LANDED,
        truncated: false,
        entries: (ref === SHOUT_HEAD ? [...STALK_FILES, 'src/shout.ts'] : STALK_FILES).map(
          (path) => ({ path, type: 'blob' }),
        ),
      }),
    repoFile: (_run: string, ref: string, path: string) =>
      path === 'README.md' || path === 'src/shout.ts'
        ? ok({
            path,
            size: 20,
            binary: false,
            content: `# ${path} at ${ref}\n`,
            truncated: false,
            commit: SLUGIFY_LANDED,
          })
        : missing(),
    repoDiff: missing,
    repoLog: () =>
      ok({
        commits: [
          commit(SLUGIFY_LANDED, [TRUNCATE_LANDED], 'Add slugify for bean names\n\nTask: slugify'),
          commit(TRUNCATE_LANDED, [ROOT], 'Add truncate for long titles\n\nTask: add-truncate'),
        ],
      }),
    repoGrep: missing,
    beansByPath: () => ok([]),
    beanDetail: missing,
    decisions: () => ok([]),
    testsFor: () => ok([]),
    verifyViewToken: missing,
    pushedBeans: () => ok(GREETER_PUSHED),
  };
  const binding = Object.fromEntries(
    Object.entries(answers).map(([method, answer]) => [
      method,
      (...args: never[]) => {
        count(method);
        return answer(...args);
      },
    ]),
  );
  return { binding: Object.assign(Object.create(null), binding), calls };
}

describe('the Code tab’s reads', () => {
  it('reads a folder of 42 files in a fixed number of gateway calls', async () => {
    const gateway = fakeGateway();
    const data = await codeData(engineReads(gateway.binding, ENGINE), {
      ref: { kind: 'stalk' },
      path: '',
      view: 'tree',
    });
    expect(data.body.kind).toBe('folder');
    if (data.body.kind !== 'folder') return;
    expect(data.body.entries.map((entry) => entry.name)).toEqual([
      'src',
      'package.json',
      'README.md',
    ]);
    expect(data.body.readme).toEqual({ path: 'README.md', text: '# README.md at stalk\n' });
    expect(data.head).toMatchObject({
      kind: 'commit',
      line: 'stalk',
      row: { bean: 'slugify', by: { kind: 'person', name: 'coop' } },
    });
    expect(Object.fromEntries(gateway.calls)).toEqual({
      pushedBeans: 1,
      repoTree: 1,
      repoLog: 1,
      repoFile: 1,
      runEvents: 2,
    });
  });

  it('browses a bean’s branch at its pushed head, and the bean leads the folder', async () => {
    const gateway = fakeGateway();
    const data = await codeData(engineReads(gateway.binding, ENGINE), {
      ref: { kind: 'bean', name: 'shout' },
      path: 'src/shout.ts',
      view: 'blob',
    });
    expect(data.sha).toBe(SHOUT_HEAD);
    expect(data.head).toMatchObject({ kind: 'bean', change: { bean: 'shout', state: 'red' } });
    expect(data.body).toMatchObject({
      kind: 'file',
      file: { content: `# src/shout.ts at ${SHOUT_HEAD}\n` },
    });
    expect(gateway.calls.get('pushedBeans')).toBe(1);
  });

  it('says what is missing: an unknown bean, a folder or a file the ref does not have', async () => {
    const reads = engineReads(fakeGateway().binding, ENGINE);
    const bean = await codeData(reads, {
      ref: { kind: 'bean', name: 'nope' },
      path: '',
      view: 'tree',
    });
    expect(bean.body).toEqual({ kind: 'missing', what: 'There is no bean named nope.' });
    const folder = await codeData(reads, { ref: { kind: 'stalk' }, path: 'docs', view: 'tree' });
    expect(folder.body).toEqual({ kind: 'missing', what: 'There is no folder docs here.' });
    const file = await codeData(reads, { ref: { kind: 'sprout' }, path: 'x.ts', view: 'blob' });
    expect(file.body).toEqual({ kind: 'missing', what: 'There is no file x.ts here.' });
  });
});
