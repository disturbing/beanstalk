// Checks the public docs (packages/site/public/docs): every relative link and anchor resolves
// to a file and an id that exist, every page's left nav lists the same pages as the overview, and
// every site page has its title, description and Open Graph text.
// Run by `pnpm -F @gitstalk/site test` (so by `pnpm check`) and by the docs-maintainer agent.
//
//   node scripts/check-docs.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'packages/site/public');
const DOCS = path.join(PUBLIC, 'docs');

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

/** Resolves a relative URL from a docs page to a file under public/, as the static host does. */
function resolveTarget(fromDir, target) {
  const resolved = path.resolve(fromDir, target);
  if (target.endsWith('/') || target === '.' || target === './') {
    return path.join(resolved, 'index.html');
  }
  if (existsSync(resolved)) return resolved;
  if (existsSync(`${resolved}.html`)) return `${resolved}.html`;
  return null;
}

function navOf(html) {
  const nav = html.match(/<nav class="inner"[\s\S]*?<\/nav>/);
  return nav ? [...nav[0].matchAll(/href="([^"]+)"/g)].map((m) => m[1]).join(' ') : '';
}

const overviewNav = navOf(readFileSync(path.join(DOCS, 'index.html'), 'utf8'));
for (const page of pages) {
  const file = path.join(DOCS, page);
  const html = readFileSync(file, 'utf8');
  if (navOf(html) !== overviewNav) problems.push(`${page}: left nav differs from index.html`);
  for (const [, link] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    if (/^(https?:|mailto:|data:)/.test(link)) continue;
    const [target, anchor] = link.split('#');
    const dest = target === '' ? file : resolveTarget(DOCS, target);
    if (!dest || !existsSync(dest)) {
      problems.push(`${page}: ${link} does not resolve`);
      continue;
    }
    if (anchor && dest.endsWith('.html') && !idsOf(dest).has(anchor)) {
      problems.push(`${page}: ${link} has no element with id "${anchor}"`);
    }
  }
}

// Every public page carries its own link-preview text; the web adds the canonical link and
// og:url on each deployment's origin (packages/web/src/site/search.ts), so none is hardcoded.
const sitePages = [
  ...readdirSync(PUBLIC).filter((name) => name.endsWith('.html') && name !== '404.html'),
  ...pages.map((page) => `docs/${page}`),
];
for (const page of sitePages) {
  const html = readFileSync(path.join(PUBLIC, page), 'utf8');
  for (const tag of [
    '<title>',
    'name="description"',
    'property="og:title"',
    'property="og:description"',
  ]) {
    if (!html.includes(tag)) problems.push(`${page}: no ${tag} in the head`);
  }
  if (/rel="canonical"|property="og:url"/.test(html)) {
    problems.push(`${page}: a hardcoded canonical or og:url (the web adds them per origin)`);
  }
  if (/content="https?:\/\/[^"]*(workers\.dev|beanstalk)/.test(html)) {
    problems.push(`${page}: a meta tag points at an old beanstalk or workers.dev host`);
  }
}

if (problems.length > 0) {
  process.stderr.write(`docs check failed:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(
  `docs check: ${pages.length} docs pages, links and nav ok; ${sitePages.length} site pages' metadata ok\n`,
);
