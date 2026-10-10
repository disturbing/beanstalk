import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { ADMIN } from './helpers';

describe('gateway', () => {
  it('answers the health check', async () => {
    const response = await SELF.fetch('https://gateway.test/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
  });

  it('answers unknown routes with the error shape', async () => {
    const response = await SELF.fetch('https://gateway.test/nope');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'no such route' },
    });
  });

  it('answers malformed JSON with the error shape, not Hono plain text', async () => {
    const response = await SELF.fetch('https://gateway.test/v1/runs', {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
      body: '{not json',
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'invalid_request' } });
  });
});
