/**
 * The marketing site on the web app's own host (docs/claude-opus/30-environments.md §13.2):
 * where a deployment serves both at one origin (gitstalk.io), the web Worker hands the site's
 * paths to the site Worker over the SITE service binding. Without that binding (local dev,
 * workers.dev stacks) nothing is forwarded and the app answers every path as before.
 */
import { SESSION_COOKIE, readCookie } from '@gitstalk/shared-identity/cookies';

/** Site pages reachable without their `.html` (each is a reserved handle, never an owner). */
const SITE_PAGES: ReadonlySet<string> = new Set(['about', 'privacy', 'terms']);

/** Root files the web app serves itself (its static assets never reach the Worker). */
const WEB_FILES: ReadonlySet<string> = new Set(['setup.sh', 'setup.ps1', 'favicon.ico']);

/** A root file name: handles and repository names never contain a dot in the first segment. */
const ROOT_FILE = /^\/[\w-]+\.(?:html|css|js|svg|png|jpg|webp|ico|txt|xml|json|webmanifest)$/;

/**
 * Whether the site, not the app, answers `request`: `/docs` and below, root files with an
 * extension (`/about.html`, `/site.css`), the three bare page names, and `/` for someone
 * signed out (the landing; signed in, `/` is Home).
 */
export function isSitePath(request: Request): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;
  const { pathname } = new URL(request.url);
  if (pathname === '/') return readCookie(request.headers.get('cookie'), SESSION_COOKIE) === null;
  if (pathname === '/docs' || pathname.startsWith('/docs/')) return true;
  if (SITE_PAGES.has(pathname.slice(1))) return true;
  return ROOT_FILE.test(pathname) && !WEB_FILES.has(pathname.slice(1));
}
