import { describe, expect, it } from 'vitest';

import { withResponseHeaders } from './response-headers';

const page = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });

describe('the headers every web response carries', () => {
  it('forbids framing on every page, not only the account pages', () => {
    const served = withResponseHeaders(page(), new Request('https://gitstalk.io/coop/demo'));
    expect(served.headers.get('x-frame-options')).toBe('DENY');
    expect(served.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(served.headers.get('x-content-type-options')).toBe('nosniff');
    expect(served.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sends HSTS on https only, never to a local http dev server', () => {
    const secure = withResponseHeaders(page(), new Request('https://gitstalk.dev/'));
    expect(secure.headers.get('strict-transport-security')).toBe(
      'max-age=31536000; includeSubDomains',
    );
    const local = withResponseHeaders(page(), new Request('http://localhost:8787/'));
    expect(local.headers.get('strict-transport-security')).toBeNull();
  });

  it("keeps a page's own referrer policy and frame-ancestors", () => {
    const own = new Response('', {
      headers: {
        'referrer-policy': 'same-origin',
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'",
      },
    });
    const served = withResponseHeaders(own, new Request('https://gitstalk.io/settings'));
    expect(served.headers.get('referrer-policy')).toBe('same-origin');
    expect(served.headers.get('content-security-policy')).toBe(
      "default-src 'self'; frame-ancestors 'none'",
    );
  });

  it('drops the router Vary from immutable /media pictures, and keeps it elsewhere', () => {
    const withVary = () =>
      new Response('img', {
        headers: { vary: 'RSC, Next-Router-State-Tree', 'cache-control': 'immutable' },
      });
    const media = withResponseHeaders(withVary(), new Request('https://gitstalk.io/media/abc/64'));
    expect(media.headers.get('vary')).toBeNull();
    expect(media.headers.get('cache-control')).toBe('immutable');
    const app = withResponseHeaders(withVary(), new Request('https://gitstalk.io/coop'));
    expect(app.headers.get('vary')).toBe('RSC, Next-Router-State-Tree');
  });
});
