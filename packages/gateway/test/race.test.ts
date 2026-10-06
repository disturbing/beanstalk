import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { REQUIRED_EVENT_KEYS } from '@beanstalk/shared-race/events';
import type { RaceEventType } from '@beanstalk/shared-race/events';

import {
  ADMIN,
  call,
  createRun,
  driveSlot,
  gitPath,
  json,
  pushBase,
  pushBody,
  slotToken,
} from './helpers';

const BASE = 'e'.repeat(40);

type Event = { seq: number; t: number; type: RaceEventType } & Record<string, unknown>;

/** What the fake runner instance received, in order (tokens included, for scope checks). */
async function runnerRequests(instance: string) {
  return json<{ path: string; body: { token: string } }[]>(
    await env.RUNNER.getByName(instance).fetch('http://runner/__requests'),
  );
}

describe('a queue race over HTTP', () => {
  it('runs two slots to the final check and logs harness events', async () => {
    const run = await createRun({ agents: 2, ci_slots: 2, batch: 2, protect_tests: 'landed' });
    await pushBase(run, BASE);
    const started = await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
    expect(started.status).toBe(200);

    const handled = await Promise.all([driveSlot(run, 'a0'), driveSlot(run, 'a1')]);

    expect(handled.flat().toSorted((a, b) => a.localeCompare(b))).toEqual([
      'inv0001-initial:t001',
      'inv0002-initial:t002',
    ]);
    const page = await json<{ events: Event[]; done: boolean }>(
      await call('GET', `/v1/runs/${run.run}/events?key=${run.view.token}`),
    );
    expect(page.done).toBe(true);
    const types = page.events.map((event) => event.type);
    expect(types[0]).toBe('race.setup');
    expect(types.at(-1)).toBe('final.check');
    expect(page.events.map((event) => event.seq)).toEqual(page.events.map((_, index) => index + 1));
    for (const event of page.events) {
      for (const key of REQUIRED_EVENT_KEYS[event.type] ?? [])
        expect(event, `${event.type}.${key}`).toHaveProperty(key);
    }
    const landed = page.events
      .filter((event) => event.type === 'land')
      .map((event) => String(event['task']));
    expect(landed.toSorted((a, b) => a.localeCompare(b))).toEqual(['t001', 't002']);
    expect(page.events.find((event) => event.type === 'final.check')).toMatchObject({
      suite_green: true,
      correct: true,
    });
  });

  it('serves the same events as JSON lines, and a summary.json', async () => {
    const run = await createRun({ agents: 1 });
    await pushBase(run, BASE);
    await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
    await driveSlot(run, 'a0');

    const lines = await call('GET', `/v1/runs/${run.run}/events?format=jsonl`, { token: ADMIN });
    const summary = await json<Record<string, unknown>>(
      await call('GET', `/v1/runs/${run.run}/summary`, { token: ADMIN }),
    );

    expect(lines.headers.get('content-type')).toContain('application/x-ndjson');
    const text = new TextDecoder().decode(await lines.arrayBuffer());
    const events: Event[] = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(events.at(-1)?.type).toBe('final.check');
    expect(summary).toMatchObject({
      policy: 'queue',
      tasks: 2,
      tasks_green: 2,
      final: { correct: true },
    });
  });

  it('sends the runner minted Artifacts tokens, never run tokens', async () => {
    const run = await createRun({ agents: 1 });
    await pushBase(run, BASE);
    await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
    await driveSlot(run, 'a0');

    const committer = env.RUNNER.getByName(`run-${run.run}-committer`);
    const requests = await json<
      { path: string; body: { token: string; change?: { token: string } } }[]
    >(await committer.fetch('http://runner/__requests'));

    expect(requests.map((request) => request.path)).toContain('/v1/squash');
    for (const request of requests) {
      expect(request.body.token).toMatch(/^art_v1_/);
      if (request.body.change !== undefined) expect(request.body.change.token).toMatch(/^art_v1_/);
    }
  });

  it('rejects a push to the bean of a task the slot is not working on', async () => {
    const run = await createRun({ agents: 1 });
    await pushBase(run, BASE);
    await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
    await call('POST', `/v1/runs/${run.run}/agents/a0/next`, { token: slotToken(run, 'a0') });

    const response = await call('POST', gitPath(run.repo.name, 'git-receive-pack'), {
      token: slotToken(run, 'a0'),
      body: pushBody('refs/heads/beans/t002', BASE),
    });

    expect(response.status).toBe(403);
  });
});

describe('a v2 race over HTTP', () => {
  it('checks each bean in its slot’s sandbox, lands it on the sprout and promotes the stalk', async () => {
    const run = await createRun({ policy: 'beanstalk-v2', agents: 2, ci_slots: 2 });
    await pushBase(run, BASE);
    await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });

    await Promise.all([driveSlot(run, 'a0'), driveSlot(run, 'a1')]);

    const page = await json<{ events: Event[]; done: boolean }>(
      await call('GET', `/v1/runs/${run.run}/events?key=${run.view.token}`),
    );
    expect(page.done).toBe(true);
    const lands = page.events.filter((event) => event.type === 'land');
    expect(lands.map((event) => event['target'])).toEqual(['trunk', 'trunk']);
    expect(lands.every((event) => event['prelanded'] === true)).toBe(true);
    expect(page.events.filter((event) => event.type === 'preland.check')).toHaveLength(2);
    expect(page.events.at(-1)).toMatchObject({ type: 'final.check', correct: true });
    const view = await json<{ policy_state: { sprout: { idx: number }; stalk: { idx: number } } }>(
      await call('GET', `/v1/runs/${run.run}`, { token: ADMIN }),
    );
    expect(view.policy_state.sprout.idx).toBe(1);
    expect(view.policy_state.stalk.idx).toBe(1);
  });

  it('gives sandboxes and CI read tokens only; the committer writes and never runs a suite', async () => {
    const run = await createRun({ policy: 'beanstalk-v2', agents: 1 });
    await pushBase(run, BASE);
    await call('POST', `/v1/runs/${run.run}/start`, { token: ADMIN });
    await driveSlot(run, 'a0');

    const sandbox = await runnerRequests(`run-${run.run}-sandbox-a0`);
    const ci = await runnerRequests(`run-${run.run}-ci-0`);
    const committer = await runnerRequests(`run-${run.run}-committer`);

    expect(sandbox.map((request) => request.path)).toEqual(['/v1/check', '/v1/check']);
    expect(ci.map((request) => request.path)).toContain('/v1/check');
    expect(
      [...sandbox, ...ci].every((request) => request.body.token.startsWith('art_v1_read_')),
    ).toBe(true);
    expect(committer.map((request) => request.path)).not.toContain('/v1/check');
    expect(committer.map((request) => request.path)).toEqual(
      expect.arrayContaining(['/v1/squash', '/v1/update-ref']),
    );
    expect(committer.every((request) => request.body.token.startsWith('art_v1_write_'))).toBe(true);
    const summary = await json<{
      policy: string;
      beanstalk: { variant: string; landings: number };
    }>(await call('GET', `/v1/runs/${run.run}/summary`, { token: ADMIN }));
    expect(summary).toMatchObject({
      policy: 'beanstalk',
      beanstalk: { variant: 'v2.5', landings: 2 },
    });
  });
});
