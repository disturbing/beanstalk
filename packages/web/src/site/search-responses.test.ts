import { describe, expect, it } from 'vitest';

import type { SearchSettings } from './search';
import { searchFileResponse, servedSiteResponse, withIndexing } from './search-responses';

const production: SearchSettings = { origin: 'https://gitstalk.io', indexing: 'index' };
const staging: SearchSettings = { origin: 'https://gitstalk.dev', indexing: 'noindex' };

const at = (path: string, init?: RequestInit) => new Request(`https://gitstalk.test${path}`, init);

/** A site page as the site Worker answers it: noindex on its own address (its `_headers`). */
const sitePage = () =>
  new Response('<html><head><title>About: Gitstalk</title></head><body></body></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8', 'x-robots-tag': 'noindex' },
  });

describe('robots.txt and sitemap.xml from the web', () => {
  it('answers /robots.txt as plain text', async () => {
    const response = searchFileResponse(at('/robots.txt'), production, 'here');
    expect(response?.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await response?.text()).toContain('Sitemap: https://gitstalk.io/sitemap.xml');
  });

  it('answers /sitemap.xml as XML', async () => {
    const response = searchFileResponse(at('/sitemap.xml'), production, 'here');
    expect(response?.headers.get('content-type')).toBe('application/xml; charset=utf-8');
    expect(await response?.text()).toContain('<loc>https://gitstalk.io/docs/</loc>');
  });

  it('answers HEAD without a body', () => {
    const head = searchFileResponse(at('/robots.txt', { method: 'HEAD' }), production, 'here');
    expect(head?.status).toBe(200);
    expect(head?.body).toBeNull();
  });

  it.each(['/robots', '/sitemap.xml.gz', '/docs/robots.txt', '/'])(
    'leaves %s to the app or the site',
    (path) => {
      expect(searchFileResponse(at(path), production, 'here')).toBeNull();
    },
  );
});

describe('site pages on the web’s origin', () => {
  it('puts the canonical link and og:url into the head, without the query', async () => {
    const response = await servedSiteResponse(sitePage(), at('/about?theme=light'), production);
    expect(await response.text()).toContain(
      '<link rel="canonical" href="https://gitstalk.io/about" />\n<meta property="og:url" content="https://gitstalk.io/about" />\n</head>',
    );
  });

  it('drops the site’s noindex where the deployment is indexed', async () => {
    const response = await servedSiteResponse(sitePage(), at('/about'), production);
    expect(response.headers.get('x-robots-tag')).toBeNull();
  });

  it('keeps a non-indexed deployment’s pages out of search results', async () => {
    const response = await servedSiteResponse(sitePage(), at('/about'), staging);
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await response.text()).toContain('href="https://gitstalk.dev/about"');
  });

  it('leaves a redirect as it is', async () => {
    const redirect = new Response(null, { status: 307, headers: { location: '/docs/git' } });
    const served = await servedSiteResponse(redirect, at('/docs/git.html'), production);
    expect(served.status).toBe(307);
    expect(served.headers.get('location')).toBe('/docs/git');
  });

  it('gives a missing page no canonical link', async () => {
    const missing = new Response('<html><head></head></html>', {
      status: 404,
      headers: { 'content-type': 'text/html' },
    });
    const served = await servedSiteResponse(missing, at('/nope'), production);
    expect(await served.text()).not.toContain('canonical');
  });

  it('passes a stylesheet through untouched', async () => {
    const css = new Response('body{}', { headers: { 'content-type': 'text/css' } });
    const served = await servedSiteResponse(css, at('/site.css'), production);
    expect(await served.text()).toBe('body{}');
  });
});

describe('the noindex header on the app', () => {
  it('marks every response of a non-indexed deployment', () => {
    const marked = withIndexing(new Response('ok'), staging);
    expect(marked.headers.get('x-robots-tag')).toBe('noindex, nofollow');
  });

  it('leaves an indexed deployment’s responses alone', () => {
    const response = new Response('ok');
    expect(withIndexing(response, production)).toBe(response);
  });
});
