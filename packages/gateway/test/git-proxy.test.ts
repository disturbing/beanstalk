import { describe, expect, it } from 'vitest';

import type { CreatedRun } from './helpers';
import { ADMIN, call, createRun, gitPath, json, pushBase, pushBody, slotToken } from './helpers';

const BASE = 'c'.repeat(40);
const HEAD = 'd'.repeat(40);

/** What the fake Artifacts remote saw (it echoes every request). */
type Upstream = {
  path: string;
  query: string;
  authorization: string;
  scope: string;
  gitProtocol: string | null;
  bytes: number;
  commands: { ref: string; newSha: string }[];
};

/** A started run where slot a0 holds t001, whose bean is `refs/heads/beans/t001`. */
async function runWithInstruction(agents = 1): Promise<CreatedRun> {
  const run = await createRun({ agents });
  await pushBase(run, BASE);
  await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
  const next = await call('POST', `/v1/runs/${run.run}/agents/a0/next`, {
    token: slotToken(run, 'a0'),
  });
  expect(await json(next)).toMatchObject({
    invocation: { task: 't001', workspace: { branch: 'beans/t001' } },
  });
  return run;
}

/** A slot's push of one ref to the run repo. */
function pushTo(run: CreatedRun, slot: string, ref: string): Promise<Response> {
  return call('POST', gitPath(run.repo.name, 'git-receive-pack'), {
    token: slotToken(run, slot),
    body: pushBody(ref, HEAD),
  });
}

describe('git proxy', () => {
  it('lets a slot read the run repo with the gateway token, never its own', async () => {
    const run = await runWithInstruction();

    const response = await call(
      'GET',
      `${gitPath(run.repo.name, 'info/refs')}?service=git-upload-pack`,
      { token: slotToken(run, 'a0'), headers: { 'git-protocol': 'version=2' } },
    );
    const upstream = await json<Upstream>(response);

    expect(response.status).toBe(200);
    expect(upstream).toMatchObject({
      path: `/git/beanstalk-race/${run.repo.name}.git/info/refs`,
      query: '?service=git-upload-pack',
      authorization: 'Bearer art_v1_',
      scope: 'read',
      gitProtocol: 'version=2',
    });
    expect(response.headers.get('www-authenticate')).toBeNull();
    expect(response.headers.get('x-upstream')).toBe('fake');
  });

  it('takes the run token as a Basic password, as git sends it from a URL', async () => {
    const run = await runWithInstruction();
    const basic = btoa(`x:${slotToken(run, 'a0')}`);

    const response = await call(
      'GET',
      `${gitPath(run.repo.name, 'info/refs')}?service=git-upload-pack`,
      { headers: { authorization: `Basic ${basic}` } },
    );

    expect(response.status).toBe(200);
  });

  it('lets a slot push its bean branch to the run repo, streaming the body through', async () => {
    const run = await runWithInstruction();
    const body = pushBody('refs/heads/beans/t001', HEAD);

    const response = await call('POST', gitPath(run.repo.name, 'git-receive-pack'), {
      token: slotToken(run, 'a0'),
      body,
    });
    const upstream = await json<Upstream>(response);

    expect(response.status).toBe(200);
    expect(upstream.scope).toBe('write');
    expect(upstream.bytes).toBe(body.length);
    expect(upstream.commands).toEqual([
      { oldSha: '0'.repeat(40), newSha: HEAD, ref: 'refs/heads/beans/t001' },
    ]);
  });

  it('refuses a slot’s push to the sprout, the stalk or another bean', async () => {
    const run = await runWithInstruction();
    const refs = ['refs/heads/sprout', 'refs/heads/stalk', 'refs/heads/beans/t002'];

    const responses = await Promise.all(refs.map((ref) => pushTo(run, 'a0', ref)));

    expect(responses.map((response) => response.status)).toEqual([403, 403, 403]);
    expect(await responses[0]?.text()).toMatch(/refs\/heads\/sprout is not allowed/);
  });

  it('refuses a push from a slot that holds no task', async () => {
    const run = await runWithInstruction(2);

    const response = await pushTo(run, 'a1', 'refs/heads/beans/t002');

    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/not working on a task/);
  });

  it('refuses tokens of another run, view tokens, and missing tokens with a Basic challenge', async () => {
    const run = await runWithInstruction();
    const other = await createRun();
    const path = `${gitPath(run.repo.name, 'info/refs')}?service=git-upload-pack`;

    const foreign = await call('GET', path, { token: slotToken(other, 'a0') });
    const viewer = await call('GET', path, { token: run.view.token });
    const missing = await call('GET', path);

    expect(foreign.status).toBe(403);
    expect(viewer.status).toBe(403);
    expect(missing.status).toBe(401);
    expect(missing.headers.get('www-authenticate')).toBe('Basic realm="beanstalk"');
  });

  it('closes the run repo to the seed token once the run has started', async () => {
    const run = await runWithInstruction();

    const response = await pushBase(run, HEAD);

    expect(response.status).toBe(409);
  });

  it('lets the seed token push only the sprout and the stalk', async () => {
    const run = await createRun();

    const response = await pushBase(run, BASE, ['refs/heads/sprout', 'refs/heads/main']);

    expect(response.status).toBe(403);
    expect(await response.text()).toMatch(/refs\/heads\/main is not allowed/);
  });

  it('answers 404 for repos that are not the run’s and for other namespaces', async () => {
    const run = await runWithInstruction();
    const token = slotToken(run, 'a0');

    const oldStyleBean = await call(
      'GET',
      `${gitPath(`race-${run.run}-t001`, 'info/refs')}?service=git-upload-pack`,
      { token },
    );
    const namespace = await call(
      'GET',
      `/git/workspace/${run.repo.name}.git/info/refs?service=git-upload-pack`,
      { token },
    );

    expect(oldStyleBean.status).toBe(404);
    expect(namespace.status).toBe(404);
  });
});
