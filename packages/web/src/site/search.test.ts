import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DOCS_PAGES } from './pages';
import type { SearchSettings } from './search';
import { robotsTxt, searchSettings, siteHeadTags, sitemapXml } from './search';

const production: SearchSettings = { origin: 'https://gitstalk.io', indexing: 'index' };
const staging: SearchSettings = { origin: 'https://gitstalk.dev', indexing: 'noindex' };

describe('search settings', () => {
  it('indexes only when SEARCH_INDEXING is "on"', () => {
    expect(searchSettings({ WEB_URL: 'https://gitstalk.io/', SEARCH_INDEXING: 'on' })).toEqual(
      production,
    );
    expect(searchSettings({ WEB_URL: 'https://gitstalk.dev', SEARCH_INDEXING: 'off' })).toEqual(
      staging,
    );
    expect(searchSettings({ WEB_URL: 'https://gitstalk.dev' }).indexing).toBe('noindex');
  });
});

describe('robots.txt', () => {
  it('names the sitemap on the deployment’s own origin when indexed', () => {
    expect(robotsTxt(production)).toContain('Sitemap: https://gitstalk.io/sitemap.xml');
    expect(disallowed(robotsTxt(production))).not.toContain('/');
  });

  it('disallows everything, and names no sitemap, when not indexed', () => {
    const robots = robotsTxt(staging);
    expect(disallowed(robots)).toEqual(['/']);
    expect(robots).not.toContain('Sitemap:');
  });

  it.each([
    '/settings',
    '/settings/tokens',
    '/api/auth',
    '/connect',
    '/new',
    '/admin',
    '/auth/email',
    '/v1/whoami',
    '/coop/repo.git',
    '/coop/repo.git/info/refs',
    '/coop/repo/info/refs',
    '/coop/repo/git-upload-pack',
    '/coop/repo/settings',
    '/orgs/acme/settings',
    '/setup.sh',
  ])('keeps crawlers out of %s', (path) => {
    expect(isDisallowed(robotsTxt(production), path)).toBe(true);
  });

  it.each([
    '/',
    '/about',
    '/docs/git',
    '/signup',
    '/signup/agent',
    '/login',
    '/newton',
    '/coop/repo',
  ])('lets crawlers read %s', (path) => {
    expect(isDisallowed(robotsTxt(production), path)).toBe(false);
  });

  it('decides about every top-level app route (the public ones are named here)', () => {
    const publicRoutes = ['login', 'signup', 'media', 'orgs'];
    const undecided = appRoutes()
      .filter((route) => !publicRoutes.includes(route))
      .filter((route) => !isDisallowed(robotsTxt(production), `/${route}`));
    expect(undecided).toEqual([]);
  });
});

describe('sitemap.xml', () => {
  it('lists the landing, the pages, every docs page and sign-up on the own origin', () => {
    const xml = sitemapXml(production, 'here');
    const paths = ['/', '/about', '/agent', '/human', '/privacy', '/terms', '/docs/'];
    for (const path of [...paths, ...DOCS_PAGES.map((page) => `/docs/${page}`)]) {
      expect(xml).toContain(`<loc>https://gitstalk.io${path}</loc>`);
    }
    expect(xml).toContain('<loc>https://gitstalk.io/signup</loc>');
    expect(xml).toContain('<loc>https://gitstalk.io/signup/agent</loc>');
    expect(xml).not.toContain('/login');
    expect(xml).not.toContain('.html');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<urlset')).toBe(true);
  });

  it('follows the deployment’s origin', () => {
    expect(sitemapXml(staging, 'here')).toContain('<loc>https://gitstalk.dev/docs/</loc>');
    expect(sitemapXml(staging, 'here')).not.toContain('gitstalk.io');
  });

  it('lists only the app’s pages when the site lives on another origin', () => {
    const xml = sitemapXml(staging, 'elsewhere');
    expect(xml).toContain('<loc>https://gitstalk.dev/signup</loc>');
    expect(xml).not.toContain('/docs/');
  });
});

describe('a site page’s head tags', () => {
  it('gives the canonical link and og:url on this origin', () => {
    expect(siteHeadTags(production, '/docs/git')).toBe(
      '<link rel="canonical" href="https://gitstalk.io/docs/git" />\n<meta property="og:url" content="https://gitstalk.io/docs/git" />\n',
    );
  });

  it('escapes what it puts in an attribute', () => {
    expect(siteHeadTags(production, '/a"b')).toContain('href="https://gitstalk.io/a&quot;b"');
  });
});

/** The app's top-level routes (`app/<segment>`), as crawlers would reach them. */
function appRoutes(): string[] {
  const app = fileURLToPath(new URL('../../app', import.meta.url));
  return readdirSync(app, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[[(_]/.test(entry.name))
    .map((entry) => entry.name);
}

/** The `Disallow` rules of a robots.txt. */
function disallowed(robots: string): string[] {
  return robots
    .split('\n')
    .filter((line) => line.startsWith('Disallow: '))
    .map((line) => line.slice('Disallow: '.length));
}

/** Whether any rule matches `path` (RFC 9309: `*` is any run of characters, `$` the end). */
function isDisallowed(robots: string, path: string): boolean {
  return disallowed(robots).some((rule) => {
    const anchored = rule.endsWith('$');
    const pattern = (anchored ? rule.slice(0, -1) : rule)
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path);
  });
}
