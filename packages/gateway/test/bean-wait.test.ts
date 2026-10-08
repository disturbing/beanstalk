import { describe, expect, it } from 'vitest';

import {
  GitStream,
  advertisedRefs,
  gitResponse,
  openRepo,
  push,
  pushBody,
  release,
  until,
} from './git-push-helpers';
import { sha } from './helpers';

/**
 * Waiting for verdicts without polling: a push to `refs/wait/any|all` and `-o wait` hold on
 * the engine object until a bean changes. The fake runner keeps a bean named `held-*` in its
 * check until the test releases it, so each test sees the wait before the verdict and the
 * verdict wake it.
 */

const WAIT_ANY = 'refs/wait/any';
const WAIT_ALL = 'refs/wait/all';

type Repo = { readonly path: string; readonly token: string; readonly engine: string };

async function repo(name: string): Promise<Repo> {
  const { opened, token } = await openRepo(name);
  return { path: opened.git_path, token, engine: opened.engineId };
}

/** A plain push of a new bean (returns once received). */
async function pushBean(target: Repo, bean: string): Promise<string> {
  const head = await sha(`${target.engine}:${bean}`);
  const { report } = await gitResponse(
    await push(
      target.path,
      target.token,
      pushBody({ ref: `refs/heads/bean/${bean}`, newSha: head }),
    ),
  );
  expect(report).toContain(`ok refs/heads/bean/${bean}`);
  return head;
}

/** A push to a wait ref, as `git push [-o …] origin HEAD:<ref>` sends it. */
async function waitPush(target: Repo, ref: string, options: string[] = []): Promise<GitStream> {
  const response = await push(
    target.path,
    target.token,
    pushBody({ ref, newSha: await sha('wait-head'), options }),
  );
  expect(response.status).toBe(200);
  return new GitStream(response);
}

describe('waiting for verdicts in git', () => {
  it('re-attaches to a bean in check: a wait naming it holds until its verdict', async () => {
    const target = await repo('reattach');
    await pushBean(target, 'held-re');
    const wait = await waitPush(target, WAIT_ANY, ['bean=held-re']);
    const before = await wait.until('waiting for the first verdict of held-re (checking)');
    expect(before.remote).not.toContain('LANDED');

    await release('held-re');
    const { remote, report } = await wait.rest();
    expect(remote).toContain('verdict for held-re: landed');
    expect(remote).toContain('LANDED: held-re passed its pre-land check');
    expect(remote).toMatch(/your beans: held-re \((landed|green)\)/);
    expect(report).toContain(`ok ${WAIT_ANY}`);
    expect(await advertisedRefs(target.path, target.token)).not.toContain('refs/wait/');
  });

  it('refuses a new commit to a bean in check, and says how to wait for it', async () => {
    const target = await repo('in-check');
    const first = await pushBean(target, 'held-new');
    const { report, remote } = await gitResponse(
      await push(
        target.path,
        target.token,
        pushBody({
          ref: 'refs/heads/bean/held-new',
          oldSha: first,
          newSha: await sha('held-new-2'),
        }),
      ),
    );
    expect(report).toContain('ng refs/heads/bean/held-new bean held-new is being checked');
    expect(remote).toContain('git push -o bean=held-new origin HEAD:refs/wait/any');

    await release('held-new');
    expect((await until(target.engine, 'held-new', ['landed', 'green'])).pushes).toBe(1);
  });

  it('wakes a wait-any on the first of two verdicts, and a wait-all on the last', async () => {
    const target = await repo('any-all');
    await pushBean(target, 'held-a');
    await pushBean(target, 'held-b');

    const any = await waitPush(target, WAIT_ANY);
    await any.until('waiting for the first verdict of held-a (checking), held-b (checking)');
    await release('held-b');
    const first = await any.rest();
    expect(first.remote).toContain('verdict for held-b: landed');
    expect(first.remote).not.toContain('verdict for held-a');
    expect(first.remote).toContain('held-a (checking)');
    expect(first.remote).toContain('wait again: git push -o bean=held-a origin HEAD:refs/wait/any');

    const all = await waitPush(target, WAIT_ALL, ['bean=held-a,held-b']);
    await all.until('waiting for every verdict of held-a (checking)');
    await release('held-a');
    const last = await all.rest();
    expect(last.remote).toContain('verdict for held-a: landed');
    expect(last.remote).toMatch(/your beans: held-a \((landed|green)\), held-b \((landed|green)\)/);
  });

  it('times out with the beans still in check and the command to wait again', async () => {
    const target = await repo('wait-timeout');
    await pushBean(target, 'held-slow');
    const { remote, report } = await (
      await waitPush(target, WAIT_ANY, ['bean=held-slow', 'wait=1'])
    ).rest();
    expect(remote).toContain('no verdict after 1 s; held-slow still checking');
    expect(remote).toContain('wait again: git push -o bean=held-slow origin HEAD:refs/wait/any');
    expect(report).toContain(`ok ${WAIT_ANY}`);
    await release('held-slow');
  });

  it('answers at once with a red bean, or when nothing is in flight', async () => {
    const target = await repo('wait-red');
    await pushBean(target, 'red-wait');
    await until(target.engine, 'red-wait', ['red']);
    const red = await (await waitPush(target, WAIT_ANY)).rest();
    expect(red.remote).toContain('red-wait is red and waits for your push');
    expect(red.remote).toContain('RED: red-wait was not landed');
    expect(red.remote).toContain('next: fix red-wait');

    const empty = await repo('wait-empty');
    const nothing = await (await waitPush(empty, WAIT_ALL, ['bean=never-pushed'])).rest();
    expect(nothing.remote).toContain('no pushed bean named never-pushed');
    expect(nothing.remote).toContain('nothing to wait for');
  });

  it('holds a push with -o wait until the verdict wakes it', async () => {
    const target = await repo('wait-option');
    const response = await push(
      target.path,
      target.token,
      pushBody({ ref: 'refs/heads/bean/held-o', newSha: await sha('held-o'), options: ['wait'] }),
    );
    const stream = new GitStream(response);
    const before = await stream.until('pre-land check started');
    expect(before.remote).not.toContain('LANDED');
    await release('held-o');
    const { remote } = await stream.rest();
    expect(remote).toContain('LANDED: held-o passed its pre-land check');
  });

  it('refuses a wait ref other than any or all', async () => {
    const target = await repo('wait-bad');
    const { report } = await (await waitPush(target, 'refs/wait/some')).rest();
    expect(report).toContain('ng refs/wait/some a wait is one push to refs/wait/any');
  });
});
