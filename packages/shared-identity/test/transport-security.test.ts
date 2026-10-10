import { describe, expect, it } from 'vitest';

import { HSTS_VALUE, withHsts } from '../src/transport-security';

describe('HSTS', () => {
  it('adds the header to an https answer and keeps its status, headers and body', async () => {
    const answer = new Response('{"ok":true}', {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
    const secured = withHsts(new Request('https://api.example/healthz'), answer);
    expect(secured.headers.get('strict-transport-security')).toBe(HSTS_VALUE);
    expect(secured.status).toBe(201);
    expect(secured.headers.get('content-type')).toBe('application/json');
    expect(await secured.text()).toBe('{"ok":true}');
  });

  it('sets it even on a response whose headers are immutable', () => {
    const immutable = Response.redirect('https://api.example/elsewhere', 302);
    const secured = withHsts(new Request('https://api.example/'), immutable);
    expect(secured.headers.get('strict-transport-security')).toBe(HSTS_VALUE);
    expect(secured.headers.get('location')).toBe('https://api.example/elsewhere');
  });

  it('leaves a plain http answer alone', () => {
    const answer = new Response('ok');
    expect(withHsts(new Request('http://localhost:8787/healthz'), answer)).toBe(answer);
  });
});
