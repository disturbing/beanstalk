import { describe, expect, it } from 'vitest';

import { NextPath, crossSiteRefusal, relyingParty } from './http';

describe('NextPath (where to go after signing in)', () => {
  it('keeps paths on this site, with their query', () => {
    expect(NextPath.parse('/connect?request=abc_DEF-123')).toBe('/connect?request=abc_DEF-123');
    expect(NextPath.parse('/settings/tokens')).toBe('/settings/tokens');
  });

  it('turns anything that could leave the site into /', () => {
    for (const evil of [
      '//evil.test',
      '/\\evil.test',
      'https://evil.test',
      'javascript:alert(1)',
      '',
      'settings',
    ])
      expect(NextPath.parse(evil), evil).toBe('/');
  });
});

describe('account requests', () => {
  it('uses the request host as the passkey relying party', () => {
    expect(
      relyingParty(
        new Request('https://gitstalk-web-staging.example.workers.dev/api/auth/passkey/signup'),
      ),
    ).toEqual({
      id: 'gitstalk-web-staging.example.workers.dev',
      origin: 'https://gitstalk-web-staging.example.workers.dev',
      name: 'Gitstalk',
    });
  });

  it('refuses a cross-site POST with 403', () => {
    const request = new Request('https://beanstalk.test/auth/signout', {
      method: 'POST',
      headers: { origin: 'https://evil.test' },
    });
    expect(crossSiteRefusal(request)?.status).toBe(403);
    const same = new Request('https://beanstalk.test/auth/signout', {
      method: 'POST',
      headers: { origin: 'https://beanstalk.test' },
    });
    expect(crossSiteRefusal(same)).toBeNull();
  });
});
