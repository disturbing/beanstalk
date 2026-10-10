// Checks the public site (packages/site/public): every internal link is a root-absolute clean
// URL (`/docs/git`, never `git.html` or `../agent.html`, which break under /docs/ or cost a 307)
// that resolves to a file and an id that exist; every docs page's left nav lists the same pages
// as the overview; and every site page has its title, description, Open Graph text and card.
// Run by `pnpm -F @gitstalk/site test` (so by `pnpm check`) and by the docs-maintainer agent.
//
//   node scripts/check-docs.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'packages/site/public');
const DOCS = path.join(PUBLIC, 'docs');

/** The web app's pages the site links to: same origin, but not files of the site. */
const APP_PATHS = new Set(['/signup', '/signup/agent', '/login']);

const pages = readdirSync(DOCS).filter((name) => name.endsWith('.html'));
const problems = [];
const idsCache = new Map();

function idsOf(file) {
  if (!idsCache.has(file)) {
    const html = readFileSync(file, 'utf8');
    idsCache.set(file, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
  }
  return idsCache.get(file);
}

/** Resolves a root-absolute clean URL to a file under public/, as the static host does. */
function resolveTarget(target) {
  const resolved = path.join(PUBLIC, target);
  if (target.endsWith('/')) return path.join(resolved, 'index.html');
  if (existsSync(`${resolved}.html`)) return `${resolved}.html`;
  if (existsSync(resolved)) return resolved;
  return null;
}

/** Problems with one link on `page`; `file` is the page the link sits in. */
function linkProblems(page, file, link) {
  if (/^(https?:|mailto:|data:)/.test(link)) return [];
  const [target, anchor] = link.split('#');
  if (target !== '' && !target.startsWith('/')) {
    return [`${page}: ${link} is relative (use a root-absolute URL such as /docs/git)`];
  }
  if (target.endsWith('.html')) return [`${page}: ${link} names a .html file (use the clean URL)`];
  if (APP_PATHS.has(target)) return [];
  const dest = target === '' ? file : resolveTarget(target);
  if (!dest || !existsSync(dest)) return [`${page}: ${link} does not resolve`];
  if (anchor && dest.endsWith('.html') && !idsOf(dest).has(anchor)) {
    return [`${page}: ${link} has no element with id "${anchor}"`];
  }
  return [];
}

function navOf(html) {
  const nav = html.match(/<nav class="inner"[\s\S]*?<\/nav>/);
  return nav ? [...nav[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1]).join(' ') : '';
}

const overviewNav = navOf(readFileSync(path.join(DOCS, 'index.html'), 'utf8'));
for (const page of pages) {
  const html = readFileSync(path.join(DOCS, page), 'utf8');
  if (navOf(html) !== overviewNav) problems.push(`${page}: left nav differs from index.html`);
}

const allPages = [
  ...readdirSync(PUBLIC).filter((name) => name.endsWith('.html')),
  ...pages.map((page) => `docs/${page}`),
];
for (const page of allPages) {
  const file = path.join(PUBLIC, page);
  const html = readFileSync(file, 'utf8');
  for (const [, link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    problems.push(...linkProblems(page, file, link));
  }
}
// The sign-up dialog in site.js is inserted into every page, the docs included.
const siteJs = readFileSync(path.join(PUBLIC, 'site.js'), 'utf8');
for (const [, link] of siteJs.matchAll(/href="([^"$]+)"/g)) {
  problems.push(...linkProblems('site.js', path.join(PUBLIC, 'index.html'), link));
}

// Every public page carries its own link-preview text and the social card's size; the web adds
// the canonical link, og:url and the card's absolute URL (og:image, twitter:image) on each
// deployment's origin (packages/web/src/site/search.ts), so none is hardcoded.
const sitePages = allPages.filter((page) => page !== '404.html');
for (const page of sitePages) {
  const html = readFileSync(path.join(PUBLIC, page), 'utf8');
  for (const tag of [
    '<title>',
    'name="description"',
    'property="og:title"',
    'property="og:description"',
    'property="og:image:alt"',
    'content="summary_large_image"',
  ]) {
    if (!html.includes(tag)) problems.push(`${page}: no ${tag} in the head`);
  }
  if (/rel="canonical"|property="og:url"|property="og:image"|name="twitter:image"/.test(html)) {
    problems.push(`${page}: a hardcoded canonical, og:url or image URL (the web adds them)`);
  }
  if (/content="https?:\/\/[^"]*(workers\.dev|beanstalk)/.test(html)) {
    problems.push(`${page}: a meta tag points at an old beanstalk or workers.dev host`);
  }
}
if (!existsSync(path.join(PUBLIC, 'og-image.png'))) problems.push('og-image.png is missing');

if (problems.length > 0) {
  process.stderr.write(`docs check failed:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(
  `docs check: ${pages.length} docs pages' nav ok; ${allPages.length} pages' links ok; ${sitePages.length} pages' metadata ok\n`,
);
