// Checks the public docs (packages/site/public/docs): every relative link and anchor resolves
// to a file and an id that exist, and every page's left nav lists the same pages as the overview.
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

if (problems.length > 0) {
  process.stderr.write(`docs check failed:\n  ${problems.join('\n  ')}\n`);
  process.exit(1);
}
process.stdout.write(`docs check: ${pages.length} pages, links and nav ok\n`);
