/**
 * The responses behind search.ts, for the web Worker's entry (worker/index.ts): the web answers
 * /robots.txt and /sitemap.xml itself, puts the canonical tags into the site's pages, and marks
 * every response of a non-indexed deployment `X-Robots-Tag: noindex`.
 */
import type { SearchSettings, SiteHosting } from './search';
import { robotsTxt, siteHeadTags, sitemapXml } from './search';

/** Crawlers re-read these often enough; an hour keeps a config change quick to show. */
const CACHE_CONTROL = 'public, max-age=3600';

const NOINDEX = 'noindex, nofollow';

/** The web's answer to GET or HEAD /robots.txt and /sitemap.xml; null for any other request. */
export function searchFileResponse(
  request: Request,
  settings: SearchSettings,
  site: SiteHosting,
): Response | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null;
  const file = searchFile(new URL(request.url).pathname, settings, site);
  if (file === null) return null;
  return new Response(request.method === 'HEAD' ? null : file.body, {
    headers: { 'content-type': file.type, 'cache-control': CACHE_CONTROL },
  });
}

/**
 * A site response as this origin serves it. A 200 HTML page gets its canonical link and
 * `og:url` before `</head>`; the site's own X-Robots-Tag (it is noindex on its workers.dev
 * address) is replaced by this deployment's.
 */
export async function servedSiteResponse(
  response: Response,
  request: Request,
  settings: SearchSettings,
): Promise<Response> {
  const isPage =
    request.method === 'GET' &&
    response.status === 200 &&
    (response.headers.get('content-type') ?? '').startsWith('text/html');
  const served = isPage
    ? withHeadTags(
        await response.text(),
        response,
        siteHeadTags(settings, new URL(request.url).pathname),
      )
    : new Response(response.body, response);
  served.headers.delete('x-robots-tag');
  return withIndexing(served, settings);
}

/** Adds `X-Robots-Tag: noindex` when this deployment is not indexed; a WebSocket upgrade passes. */
export function withIndexing(response: Response, settings: SearchSettings): Response {
  if (settings.indexing === 'index' || response.status === 101) return response;
  const marked = new Response(response.body, response);
  marked.headers.set('x-robots-tag', NOINDEX);
  return marked;
}

function searchFile(
  pathname: string,
  settings: SearchSettings,
  site: SiteHosting,
): { readonly body: string; readonly type: string } | null {
  if (pathname === '/robots.txt') {
    return { body: robotsTxt(settings), type: 'text/plain; charset=utf-8' };
  }
  if (pathname === '/sitemap.xml') {
    return { body: sitemapXml(settings, site), type: 'application/xml; charset=utf-8' };
  }
  return null;
}

function withHeadTags(html: string, original: Response, tags: string): Response {
  const at = html.indexOf('</head>');
  const body = at === -1 ? html : `${html.slice(0, at)}${tags}${html.slice(at)}`;
  const headers = new Headers(original.headers);
  headers.delete('content-length');
  return new Response(body, { status: original.status, statusText: original.statusText, headers });
}
