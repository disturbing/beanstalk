/**
 * Where the admin area's pages live, and where the old public race URLs (`/race`, `/races`,
 * `/runs/<run>…`) point now. Pure and client-safe: the race canvas links with these.
 */

export const ADMIN_HOME = '/admin';
export const ADMIN_RUNS = '/admin/runs';
export const ADMIN_RACE = '/admin/race';
export const ADMIN_DEMO_GATE = '/admin/demo-gate';

/** A benchmark run's repository view in the admin area (`/admin/runs/<run>`). */
export function adminRunPath(run: string): string {
  return `${ADMIN_RUNS}/${run}`;
}

/**
 * The admin page an old public race URL now lives at, with its query kept (a gateway
 * `live_url` carries `?key=`); null when the path was never a race page.
 */
export function adminPathOf(publicPath: string, query: URLSearchParams): string | null {
  const path = adminPathOnly(publicPath);
  if (path === null) return null;
  const search = query.toString();
  return search === '' ? path : `${path}?${search}`;
}

/** A page's search params as a query (repeated keys kept, in order). */
export function queryOf(
  searchParams: Readonly<Record<string, string | readonly string[] | undefined>>,
): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    for (const one of typeof value === 'string' ? [value] : (value ?? [])) query.append(key, one);
  }
  return query;
}

function adminPathOnly(publicPath: string): string | null {
  if (publicPath === '/race') return ADMIN_RACE;
  if (publicPath === '/races') return ADMIN_RUNS;
  if (publicPath.startsWith('/runs/') && publicPath.length > '/runs/'.length)
    return `/admin${publicPath}`;
  return null;
}
