import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE } from '@gitstalk/shared-identity/cookies';

import { isSitePath } from './forward';

const at = (path: string, init?: RequestInit) => new Request(`https://gitstalk.test${path}`, init);

describe('the marketing site on the web host', () => {
  it.each(['/docs', '/docs/', '/docs/git.html', '/about.html', '/site.css', '/favicon.svg'])(
    'hands %s to the site',
    (path) => {
      expect(isSitePath(at(path))).toBe(true);
    },
  );

  it.each(['/about', '/agent', '/human', '/privacy', '/terms'])(
    'serves the page %s without its .html',
    (path) => {
      expect(isSitePath(at(path))).toBe(true);
    },
  );

  it.each(['/setup.sh', '/setup.ps1', '/login', '/coop/repo', '/coop/repo.git/info/refs', '/v1/x'])(
    'keeps %s in the app',
    (path) => {
      expect(isSitePath(at(path))).toBe(false);
    },
  );

  it('serves the landing at / only to someone signed out', () => {
    expect(isSitePath(at('/'))).toBe(true);
    expect(isSitePath(at('/', { headers: { cookie: `${SESSION_COOKIE}=abc` } }))).toBe(false);
  });

  it('never forwards a write', () => {
    expect(isSitePath(at('/docs/', { method: 'POST' }))).toBe(false);
  });
});
