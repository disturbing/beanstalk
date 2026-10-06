export const ADMIN = 'test-swarm-admin-token-0123456789abcdef';

export function admin(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${ADMIN}`);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  return { ...init, headers };
}

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** An unsigned JWT with the claims Codex and the broker read. Test data only. */
export function fakeJwt(claims: Record<string, unknown>): string {
  return `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url(claims)}.c2ln`;
}

/** A ChatGPT-mode auth.json with made-up tokens expiring `expiresIn` seconds from now. */
export function fakeAuthJson(expiresIn: number, marker = 'one'): string {
  const exp = Math.floor(Date.now() / 1000) + expiresIn;
  return JSON.stringify({
    OPENAI_API_KEY: null,
    auth_mode: 'chatgpt',
    last_refresh: new Date().toISOString(),
    tokens: {
      id_token: fakeJwt({ aud: 'app_test_client', exp }),
      access_token: fakeJwt({ exp, marker }),
      refresh_token: `refresh-${marker}`,
      account_id: 'acct-test-0001',
    },
  });
}

export function matchBody(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    gateway_run: 'run-test-1',
    slots: [
      { slot: 'a1', token: 'slot-token-a1-0123456789' },
      { slot: 'a2', token: 'slot-token-a2-0123456789' },
    ],
    credential: { mode: 'none' },
    max_usd: 1,
    driver: { policy: 'beanstalk-v2', base_sha: 'abc', race: { agent: 'replay' } },
    ...overrides,
  });
}
