import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('gateway', () => {
  it('answers the health check', async () => {
    const response = await SELF.fetch('https://gateway.test/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('answers unknown routes with the error shape', async () => {
    const response = await SELF.fetch('https://gateway.test/nope');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: 'not_found', message: 'no such route' },
    });
  });
});
