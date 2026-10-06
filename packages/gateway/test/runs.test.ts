import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { ADMIN, arenaTask, call, createRun, json, pushBase, slotToken } from './helpers';

const BASE = 'b'.repeat(40);

describe('admin routes', () => {
  it('creates a run with its repo (sprout and stalk), slot tokens and a view link', async () => {
    const run = await createRun();

    expect(run.run).toMatch(/^[a-z0-9]{10}$/);
    expect(run.repo).toEqual({
      name: `race-${run.run}`,
      url: `https://gateway.test/git/beanstalk-race/race-${run.run}.git`,
      sprout: 'refs/heads/sprout',
      stalk: 'refs/heads/stalk',
    });
    expect(run.slots.map((slot) => slot.slot)).toEqual(['a0', 'a1']);
    expect(run.view.live_url).toMatch(new RegExp(`/runs/${run.run}\\?key=bst1\\.`));
    using repo = await env.ARTIFACTS.get(run.repo.name);
    expect((await repo.info()).defaultBranch).toBe('stalk');
  });

  it('refuses every admin route without the admin token', async () => {
    const run = await createRun();
    const routes: [string, string][] = [
      ['POST', '/v1/runs'],
      ['POST', `/v1/runs/${run.run}/start`],
      ['POST', `/v1/runs/${run.run}/stop`],
      ['POST', `/v1/runs/${run.run}/seed-token`],
      ['POST', `/v1/runs/${run.run}/tokens`],
      ['POST', `/v1/runs/${run.run}/view-token`],
      ['POST', `/v1/runs/${run.run}/decisions/D001`],
      ['POST', `/v1/runs/${run.run}/reap`],
    ];
    const statuses = await Promise.all(
      routes.flatMap(([method, path]) => [
        call(method, path, { body: {} }),
        call(method, path, { token: 'not-the-admin', body: {} }),
      ]),
    );

    expect(statuses.map((response) => response.status)).toEqual(routes.flatMap(() => [401, 401]));
  });

  it('refuses a slot or view token on admin routes', async () => {
    const run = await createRun();

    const response = await call('POST', `/v1/runs/${run.run}/start`, { token: run.view.token });

    expect(response.status).toBe(401);
  });

  it('validates the run config and names the bad field', async () => {
    const response = await call('POST', '/v1/runs', {
      token: ADMIN,
      body: { policy: 'queue', agents: 0, tasks: [arenaTask('t001')] },
    });

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: { code: 'invalid_request', issues: [{ path: 'agents' }] },
    });
  });

  it('refuses a policy this build does not run yet', async () => {
    const response = await call('POST', '/v1/runs', {
      token: ADMIN,
      body: { policy: 'beanstalk', tasks: [arenaTask('t001')] },
    });

    expect(response.status).toBe(422);
  });

  it('refuses to start before the arena base is on the sprout and the stalk', async () => {
    const run = await createRun();
    const unseeded = await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
    await pushBase(run, BASE, ['refs/heads/sprout']);

    const halfSeeded = await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });

    expect(unseeded.status).toBe(409);
    expect(await json(unseeded)).toMatchObject({ error: { code: 'repo_not_seeded' } });
    expect(await json(halfSeeded)).toMatchObject({ error: { code: 'repo_not_seeded' } });
  });

  it('refuses to start when the sprout and the stalk disagree', async () => {
    const run = await createRun();
    await pushBase(run, BASE, ['refs/heads/sprout']);
    await pushBase(run, 'f'.repeat(40), ['refs/heads/stalk']);

    const response = await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      error: { code: 'repo_not_seeded', message: expect.stringContaining('must both point') },
    });
  });

  it('starts from the base the admin seeded both lines with', async () => {
    const run = await createRun();
    expect((await pushBase(run, BASE)).status).toBe(200);

    const started = await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
    const again = await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });

    expect(await json(started)).toEqual({ run: run.run, phase: 'running', base_sha: BASE });
    expect(again.status).toBe(409);
  });

  it('answers 404 for an unknown run', async () => {
    const response = await call('GET', '/v1/runs/zzzzzzzzzz', { token: ADMIN });

    expect(response.status).toBe(404);
  });

  it('reads a run with the admin token or its view token, not another run’s', async () => {
    const run = await createRun();
    const other = await createRun();

    const asAdmin = await call('GET', `/v1/runs/${run.run}`, { token: ADMIN });
    const asViewer = await call('GET', `/v1/runs/${run.run}?key=${run.view.token}`);
    const asStranger = await call('GET', `/v1/runs/${run.run}?key=${other.view.token}`);

    expect(asAdmin.status).toBe(200);
    expect(await json(asViewer)).toMatchObject({ run: run.run, phase: 'created', policy: 'queue' });
    expect(asStranger.status).toBe(403);
  });

  it('re-issues slot tokens', async () => {
    const run = await createRun();

    const response = await call('POST', `/v1/runs/${run.run}/tokens`, { token: ADMIN });
    const body = await json<{ slots: { slot: string; token: string }[] }>(response);

    expect(body.slots.map((slot) => slot.slot)).toEqual(['a0', 'a1']);
    const reissued = await call('GET', `/v1/runs/${run.run}?key=${body.slots[0]?.token ?? ''}`);
    expect(reissued.status).toBe(200);
  });

  it('mints a view token that reads the run (the MCP server and plugin use it)', async () => {
    const run = await createRun();

    const response = await call('POST', `/v1/runs/${run.run}/view-token`, { token: ADMIN });
    const body = await json<{ run: string; token: string; expires_at: string }>(response);
    const viewed = await call('GET', `/v1/runs/${run.run}?key=${body.token}`);

    expect(body.run).toBe(run.run);
    expect(body.token).toMatch(/^bst1\./);
    expect(viewed.status).toBe(200);
  });

  it('stops a run before it starts', async () => {
    const run = await createRun();

    const stopped = await call('POST', `/v1/runs/${run.run}/stop`, { token: ADMIN, body: {} });
    const next = await call('POST', `/v1/runs/${run.run}/agents/a0/next`, {
      token: slotToken(run, 'a0'),
    });

    expect(await json(stopped)).toEqual({ run: run.run, phase: 'done' });
    expect(await json(next)).toEqual({ done: true, aborted: 'stopped by admin' });
  });
});

describe('driver routes', () => {
  it('refuses a slot token used for another slot or another run', async () => {
    const run = await createRun();
    const other = await createRun();

    const wrongSlot = await call('POST', `/v1/runs/${run.run}/agents/a1/next`, {
      token: slotToken(run, 'a0'),
    });
    const wrongRun = await call('POST', `/v1/runs/${run.run}/agents/a0/next`, {
      token: slotToken(other, 'a0'),
    });
    const noToken = await call('POST', `/v1/runs/${run.run}/agents/a0/next`);

    expect(wrongSlot.status).toBe(403);
    expect(wrongRun.status).toBe(403);
    expect(noToken.status).toBe(401);
  });

  it('refuses results for unknown invocations and malformed bodies', async () => {
    const run = await createRun();
    const token = slotToken(run, 'a0');

    const unknown = await call('POST', `/v1/runs/${run.run}/invocations/inv0042-initial/result`, {
      token,
      body: { ok: true },
    });
    const malformed = await call('POST', `/v1/runs/${run.run}/invocations/inv0042-initial/result`, {
      token,
      body: { ok: 'yes' },
    });

    expect(unknown.status).toBe(404);
    expect(malformed.status).toBe(400);
  });
});

describe('live page', () => {
  it('serves the page and keeps the feed behind the view token', async () => {
    const run = await createRun();

    const page = await call('GET', `/runs/${run.run}?key=${run.view.token}`);
    const feed = await call('GET', `/v1/runs/${run.run}/live`, {
      headers: { upgrade: 'websocket' },
    });

    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(await page.text()).toContain(`/v1/runs/' + run + '/live`);
    expect(feed.status).toBe(401);
  });
});

describe('decision route', () => {
  it('answers 404 for a card the run never opened and 400 for a malformed answer', async () => {
    const run = await createRun({ policy: 'beanstalk-v2' });
    await pushBase(run, BASE);
    await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
    const decide = (card: string, body: unknown) =>
      call('POST', `/v1/runs/${run.run}/decisions/${card}`, { token: ADMIN, body });

    const unknown = await decide('D001', { winner: 't001' });
    const empty = await decide('D001', { winner: '' });
    const extra = await decide('D001', { winner: 't001', loser: 't002' });
    const notACard = await decide('R001', { winner: 't001' });

    expect(unknown.status).toBe(404);
    expect(await json(unknown)).toMatchObject({ error: { code: 'unknown_card' } });
    expect([empty.status, extra.status, notACard.status]).toEqual([400, 400, 400]);
  });

  it('refuses an answer before the run starts', async () => {
    const run = await createRun({ policy: 'beanstalk-v2' });

    const response = await call('POST', `/v1/runs/${run.run}/decisions/D001`, {
      token: ADMIN,
      body: { winner: 't001' },
    });

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({ error: { code: 'invalid_state' } });
  });
});

type ReapResponse = {
  run: string;
  dry_run: boolean;
  repos: string[];
  deleted: string[];
  failed: unknown[];
};

async function reap(run: string, body: Record<string, unknown> = {}): Promise<ReapResponse> {
  return json<ReapResponse>(await call('POST', `/v1/runs/${run}/reap`, { token: ADMIN, body }));
}

describe('reaping a run’s repos', () => {
  it('lists, then deletes, the repos of a finished run and nothing else', async () => {
    const run = await createRun({ keep_repo: true });
    const other = await createRun();
    await env.ARTIFACTS.create(`race-${run.run}-t001`);
    await call('POST', `/v1/runs/${run.run}/stop`, { token: ADMIN, body: {} });

    const listed = await reap(run.run);
    const reaped = await reap(run.run, { dry_run: false });
    const after = await reap(run.run);

    const repos = [`race-${run.run}`, `race-${run.run}-t001`];
    expect(listed).toEqual({ run: run.run, dry_run: true, repos, deleted: [], failed: [] });
    expect(reaped).toEqual({ run: run.run, dry_run: false, repos, deleted: repos, failed: [] });
    expect(after.repos).toEqual([]);
    using kept = await env.ARTIFACTS.get(other.repo.name);
    expect((await kept.info()).name).toBe(other.repo.name);
  });

  it('refuses while the race runs', async () => {
    const run = await createRun();
    await pushBase(run, BASE);
    await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });

    const response = await call('POST', `/v1/runs/${run.run}/reap`, {
      token: ADMIN,
      body: { dry_run: false },
    });

    expect(response.status).toBe(409);
  });

  it('finds the repos of a run this gateway never knew', async () => {
    const orphan = `o${crypto.randomUUID().replaceAll('-', '').slice(0, 11)}`;
    await env.ARTIFACTS.create(`race-${orphan}-t003`);

    expect((await reap(orphan)).repos).toEqual([`race-${orphan}-t003`]);
  });
});
