import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { admin, fakeAuthJson, matchBody } from './helpers';

const SELF = exports.default;

async function json(response: Response): Promise<Record<string, unknown>> {
  return response.json();
}

describe('admin surface', () => {
  it('answers health without a token and refuses /v1 without one', async () => {
    expect((await SELF.fetch('http://swarm/healthz')).status).toBe(200);
    expect((await SELF.fetch('http://swarm/v1/matches')).status).toBe(401);
    const wrong = await SELF.fetch('http://swarm/v1/matches', {
      headers: { authorization: 'Bearer nope' },
    });
    expect(wrong.status).toBe(401);
  });

  it('stores a seat and never answers with a token', async () => {
    const auth = fakeAuthJson(3600, 'stored');
    const put = await SELF.fetch(
      'http://swarm/v1/seats/default?refreshable=1',
      admin({ method: 'PUT', body: auth }),
    );
    expect(put.status).toBe(201);
    const text = JSON.stringify(await json(put));
    expect(text).not.toContain('refresh-stored');
    expect(text).toContain('"refreshable":true');
    const list = await (await SELF.fetch('http://swarm/v1/seats', admin())).text();
    expect(list).toContain('default');
    expect(list).not.toContain('refresh-stored');
  });

  it('refuses a body that is not a ChatGPT auth.json without echoing it', async () => {
    const put = await SELF.fetch(
      'http://swarm/v1/seats/bad',
      admin({ method: 'PUT', body: '{"OPENAI_API_KEY":"sk-secret-value-123"}' }),
    );
    expect(put.status).toBe(400);
    expect(await put.text()).not.toContain('sk-secret-value-123');
  });

  it('refuses a lease match with more than one agent', async () => {
    const response = await SELF.fetch(
      'http://swarm/v1/matches',
      admin({ method: 'POST', body: matchBody({ credential: { mode: 'lease' } }) }),
    );
    expect(response.status).toBe(400);
  });

  it('refuses new matches while the swarm is halted', async () => {
    const halt = await SELF.fetch(
      'http://swarm/v1/admin/halt',
      admin({ method: 'POST', body: JSON.stringify({ reason: 'test' }) }),
    );
    expect(halt.status).toBe(200);
    const refused = await SELF.fetch(
      'http://swarm/v1/matches',
      admin({ method: 'POST', body: matchBody() }),
    );
    expect(refused.status).toBe(409);
    await SELF.fetch('http://swarm/v1/admin/resume', admin({ method: 'POST' }));
  });

  it('creates a match, waits for every hello, then releases one shared start', async () => {
    const created = await SELF.fetch(
      'http://swarm/v1/matches',
      admin({ method: 'POST', body: matchBody() }),
    );
    expect(created.status).toBe(201);
    const view = await json(created);
    const id = String(view['match']);
    expect(view['state']).toBe('starting');
    // No Docker in tests: the container start fails and is recorded, never thrown.
    expect(JSON.stringify(view['agents'])).toContain('start_error');

    const early = await SELF.fetch(
      `http://swarm/v1/matches/${id}/release`,
      admin({ method: 'POST' }),
    );
    expect(early.status).toBe(409);

    const match = env.MATCHES.get(env.MATCHES.idFromName(id));
    expect(await match.slotConfig('a1')).toEqual({ released: false, halted: false, reason: null });
    await match.hello('a1', { codexVersion: 'codex-cli 0.160.1', harness: 'abc' });
    await match.hello('a2', { codexVersion: null, harness: null });
    expect((await match.view()).state).toBe('ready');

    const released = await SELF.fetch(
      `http://swarm/v1/matches/${id}/release`,
      admin({ method: 'POST' }),
    );
    expect(released.status).toBe(200);
    const config: Record<string, unknown> = { ...(await match.slotConfig('a2')) };
    expect(config['released']).toBe(true);
    expect(config['config']).toMatchObject({
      slot: 'a2',
      run: 'run-test-1',
      codex: { config_overrides: [], placeholder_auth: false },
    });
    expect(JSON.stringify(config)).not.toContain('slot-token');

    await match.recordSpend('inv-1', 0.4);
    await match.recordSpend('inv-1', 0.3); // a later, lower estimate never lowers the spend
    expect((await match.view()).usd.agents).toBe(0.4);
    expect((await match.modelAccess('a1')).ok).toBe(true);
    await match.recordSpend('inv-2', 0.7);
    expect(await match.modelAccess('a1')).toMatchObject({ ok: false });

    const halted = await SELF.fetch(
      `http://swarm/v1/matches/${id}/halt`,
      admin({ method: 'POST', body: JSON.stringify({ reason: 'test over' }) }),
    );
    expect((await json(halted))['state']).toBe('halted');
    expect(await match.slotConfig('a1')).toMatchObject({ halted: true });
  });

  it('keeps slot logs and files for download', async () => {
    const created = await json(
      await SELF.fetch('http://swarm/v1/matches', admin({ method: 'POST', body: matchBody() })),
    );
    const id = String(created['match']);
    const match = env.MATCHES.get(env.MATCHES.idFromName(id));
    await match.appendLog('a1', '{"seq":1}\n');
    await match.appendLog('a2', '{"seq":1}\n');
    const bytes = new TextEncoder().encode('line\n');
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    await match.putFile('a1', 'inv-1.jsonl', buffer);
    const log = await SELF.fetch(`http://swarm/v1/matches/${id}/log`, admin());
    expect(await log.text()).toBe('{"seq":1}\n{"seq":1}\n');
    const files = await json(await SELF.fetch(`http://swarm/v1/matches/${id}/files`, admin()));
    expect(files['files']).toEqual([{ slot: 'a1', name: 'inv-1.jsonl', bytes: 5 }]);
    const file = await SELF.fetch(
      `http://swarm/v1/matches/${id}/file?slot=a1&name=inv-1.jsonl`,
      admin(),
    );
    expect(await file.text()).toBe('line\n');
  });
});
