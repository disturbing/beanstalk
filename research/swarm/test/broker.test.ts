import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import { AuthJsonSchema, jwtClaims, needsRefresh, refreshAuth } from '../src/broker/chatgpt-auth';
import { importSeatKey, open, seal } from '../src/broker/seat-crypto';
import { codexSetup } from '../src/agent/codex-provider';
import { fakeAuthJson, fakeJwt } from './helpers';

describe('seat crypto', () => {
  it('round-trips under the seat key and fails under another', async () => {
    const key = await importSeatKey(env.SEAT_KEY);
    const sealed = await seal(key, 'secret text');
    expect(new TextDecoder().decode(sealed.ciphertext)).not.toContain('secret');
    expect(await open(key, sealed)).toBe('secret text');
    const other = await importSeatKey(btoa(String.fromCharCode(...new Uint8Array(32).fill(2))));
    await expect(open(other, sealed)).rejects.toThrow();
  });
});

describe('ChatGPT auth', () => {
  it('reads expiry and client id, and refreshes with the id token audience', async () => {
    const auth = AuthJsonSchema.parse(JSON.parse(fakeAuthJson(60, 'old')));
    expect(jwtClaims(auth.tokens.id_token).aud).toBe('app_test_client');
    expect(needsRefresh(auth, Date.now() / 1000)).toBe(true);
    let sent: Record<string, unknown> = {};
    const fresh = await refreshAuth(auth, 'https://auth.example/token', async (_url, init) => {
      sent = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
      return Response.json({ access_token: fakeJwt({ exp: 1 }), refresh_token: 'refresh-new' });
    });
    expect(sent['client_id']).toBe('app_test_client');
    expect(sent['refresh_token']).toBe('refresh-old');
    expect(fresh.tokens.refresh_token).toBe('refresh-new');
    expect(fresh.tokens.account_id).toBe('acct-test-0001');
  });
});

describe('broker leases', () => {
  it('leases a seat to one holder at a time and frees it when the match ends', async () => {
    const broker = env.BROKER.get(env.BROKER.idFromName('lease-test'));
    await broker.putSeat('solo', fakeAuthJson(3600, 'lease'), false);
    const first = await broker.lease('solo', 'm-1:a1');
    expect(first.ok).toBe(true);
    expect(await broker.lease('solo', 'm-2:a1')).toMatchObject({ ok: false });
    await broker.matchEnded('m-1');
    expect((await broker.lease('solo', 'm-2:a1')).ok).toBe(true);
  });

  it('refuses an expired seat it may not refresh', async () => {
    const broker = env.BROKER.get(env.BROKER.idFromName('expired-test'));
    await broker.putSeat('old', fakeAuthJson(-10, 'expired'), false);
    const grant = await broker.lease('old', 'm-1:a1');
    expect(grant).toMatchObject({ ok: false });
  });
});

describe('codex provider', () => {
  it('points Codex at model.internal and never carries a credential', () => {
    const apiKey = codexSetup({ mode: 'api-key' });
    expect(apiKey.config_overrides.join(' ')).toContain('base_url="http://model.internal/v1"');
    expect(apiKey.placeholder_auth).toBe(false);
    const lease = codexSetup({ mode: 'lease', seat: 'default' });
    expect(lease.config_overrides.join(' ')).toContain('requires_openai_auth=true');
    expect(lease.placeholder_auth).toBe(true);
  });
});
