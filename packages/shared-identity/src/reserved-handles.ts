/**
 * Handles no one can sign up with. A handle is the first segment of a repository's address
 * on the web (`/<owner>/<repo>`) and on git (`/git/<owner>/<repo>.git`), so it must never be
 * one of the app's own top-level routes or the gateway's race namespaces, nor read as
 * official. The web app's test (`packages/web/src/repositories/reserved-routes.test.ts`)
 * walks its router and fails when a top-level route is missing here.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  // The web app's top-level routes (packages/web/app/*) and its static files.
  'api',
  'assets',
  'auth',
  'connect',
  'login',
  'media',
  'new',
  'race',
  'races',
  'runs',
  'settings',
  'signup',
  // The marketing site's pages on the web host (packages/web/src/site/forward.ts).
  'agent',
  'human',
  'sitemap',
  'robots',
  // Routes the product plans or other apps commonly take.
  'about',
  'admin',
  'app',
  'authorize',
  'billing',
  'blog',
  'dashboard',
  'docs',
  'explore',
  'help',
  'home',
  'inbox',
  'logout',
  'notifications',
  'oauth',
  'org',
  'orgs',
  'organizations',
  'pricing',
  'privacy',
  'register',
  'search',
  'security',
  'signin',
  'signout',
  'status',
  'support',
  'terms',
  'token',
  'tokens',
  'user',
  'users',
  'www',
  // The other Workers' paths: git, MCP, the gateway's API and health check.
  'git',
  'mcp',
  'v1',
  'healthz',
  // The gateway's Artifacts namespaces: `/git/<namespace>/…` is a race's proxy path
  // (gitstalk-* since the domain move; the old stack's beanstalk-* names stay reserved).
  'gitstalk-race',
  'gitstalk-repos',
  'beanstalk-race',
  'beanstalk-repos',
  // Product words that would read as official.
  'beanstalk',
  'beans',
  'gitstalk',
  'root',
  'site',
  'sprout',
  'stalk',
  'system',
]);

/** Whether `handle` (any case) is reserved. */
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLES.has(handle.trim().toLowerCase());
}
