/**
 * What search engines see of a deployment (docs/claude-opus/30-environments.md §14): its
 * /robots.txt and /sitemap.xml, the noindex header on deployments that must stay out of
 * results, and the canonical link of every site page. All of it follows two web vars that
 * scripts/environments.mjs writes per environment: WEB_URL (this deployment's origin) and
 * SEARCH_INDEXING ("on" only where env.jsonc sets `search_indexing: true`, i.e. production).
 */
import { SOCIAL_CARD } from './page-metadata';
import { APP_PUBLIC_PAGES, sitePagePaths } from './pages';

/** How this deployment presents itself to crawlers. */
export type SearchSettings = {
  /** The canonical origin, without a trailing slash (`https://gitstalk.io`). */
  readonly origin: string;
  /** Whether this deployment may appear in search results (production only). */
  readonly indexing: 'index' | 'noindex';
};

/** The web vars the settings come from (generated into the web's Env per environment). */
export type SearchVars = { readonly WEB_URL?: string; readonly SEARCH_INDEXING?: string };

/** Whether the site is served on this origin (the web has a SITE binding) or elsewhere. */
export type SiteHosting = 'here' | 'elsewhere';

/**
 * App areas crawlers are kept out of: accounts and settings, APIs, the OAuth and agent flows,
 * the admin and benchmark pages, git's smart-HTTP endpoints and the setup scripts. Reserved
 * words are matched exactly or as a directory (`/new$`, `/new/`) so an owner whose handle merely
 * starts with one (`/newton`) stays crawlable; public repositories and profiles are allowed.
 */
const DISALLOWED: ReadonlyArray<string> = [
  ...['admin', 'api', 'auth', 'connect', 'new', 'race', 'races', 'runs', 'settings', 'v1'].flatMap(
    (word) => [`/${word}$`, `/${word}/`],
  ),
  '/orgs/new$',
  '/orgs/*/settings',
  '/setup.sh',
  '/setup.ps1',
  '/*/*/settings',
  '/*.git$',
  '/*.git/',
  '/*/info/refs',
  '/*/git-upload-pack',
  '/*/git-receive-pack',
];

/** Reads the settings from the web's vars; anything but SEARCH_INDEXING="on" is noindex. */
export function searchSettings(vars: SearchVars): SearchSettings {
  return {
    origin: (vars.WEB_URL ?? '').replace(/\/+$/, ''),
    indexing: vars.SEARCH_INDEXING === 'on' ? 'index' : 'noindex',
  };
}

/**
 * /robots.txt. Indexed: the private areas are disallowed and the sitemap is named. Not indexed
 * (staging, workers.dev stacks, local dev): everything is disallowed. Cloudflare's managed
 * robots.txt, when the zone turns it on, prepends its content-signal comments to this file.
 */
export function robotsTxt(settings: SearchSettings): string {
  if (settings.indexing === 'noindex') {
    return '# A non-production Gitstalk deployment: keep it out of search results.\nUser-agent: *\nDisallow: /\n';
  }
  return [
    '# Gitstalk: the landing, docs, sign-up and public repositories may be crawled; the app may not.',
    'User-agent: *',
    'Allow: /',
    ...DISALLOWED.map((rule) => `Disallow: ${rule}`),
    '',
    `Sitemap: ${settings.origin}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * /sitemap.xml: the site's pages when the site is served on this origin, then sign-up. A
 * sitemap may only list URLs on its own origin, so a deployment whose site lives elsewhere
 * lists only the app's pages.
 */
export function sitemapXml(settings: SearchSettings, site: SiteHosting): string {
  const paths = [...(site === 'here' ? sitePagePaths() : []), ...APP_PUBLIC_PAGES];
  const urls = paths.map(
    (path) => `  <url><loc>${escapeXml(`${settings.origin}${path}`)}</loc></url>`,
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    '</urlset>',
    '',
  ].join('\n');
}

/**
 * The tags a site page gets on this origin: its canonical URL, `og:url` and the social card's
 * absolute URL (`og:image`, `twitter:image`). The static pages carry their own title,
 * description, Open Graph text and card size; only the origin is per deployment. The site
 * answers `.html` and unslashed paths with a redirect, so a 200's path is canonical.
 */
export function siteHeadTags(settings: SearchSettings, pathname: string): string {
  const url = escapeXml(`${settings.origin}${pathname}`);
  const image = escapeXml(`${settings.origin}${SOCIAL_CARD.url}`);
  return [
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    '',
  ].join('\n');
}

function escapeXml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
