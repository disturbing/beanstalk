/**
 * Git on the web host, as GitHub does it: `https://<web>/<owner>/<repo>` is the repository's
 * page and `git clone https://<web>/<owner>/<repo>[.git]` clones it. The three smart-HTTP
 * endpoints (`info/refs?service=…`, `git-upload-pack`, `git-receive-pack`) are route handlers
 * under `app/[owner]/[repo]/`, so no page is shadowed; each forwards the request to the
 * gateway's git proxy through the service binding, untouched: method, auth and git headers,
 * the streaming body (push options and the pack), and the streaming side-band response.
 */

export type GitService = 'info/refs' | 'git-upload-pack' | 'git-receive-pack';

/** The gateway as the forwarder needs it (the GATEWAY service binding). */
export type GitGateway = { fetch(request: Request): Promise<Response> };

const ADVERTISED = new Set(['git-upload-pack', 'git-receive-pack']);

/** Forwards one git request for `<owner>/<repo>` (with or without `.git`) to the gateway. */
export async function forwardGit(
  gateway: GitGateway,
  request: Request,
  target: { readonly owner: string; readonly repo: string; readonly service: GitService },
): Promise<Response> {
  const incoming = new URL(request.url);
  if (target.service === 'info/refs' && !ADVERTISED.has(incoming.searchParams.get('service') ?? ''))
    return new Response('only smart HTTP is served\n', { status: 404 });
  const repo = decodeURIComponent(target.repo).replace(/\.git$/, '');
  const url = new URL(
    `/git/${encodeURIComponent(decodeURIComponent(target.owner))}/${encodeURIComponent(repo)}.git/${target.service}`,
    'https://gateway.internal',
  );
  url.search = incoming.search;
  const headers = new Headers(request.headers);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return gateway.fetch(
    new Request(url, {
      method: request.method,
      headers,
      ...(hasBody ? { body: request.body, duplex: 'half' } : {}),
      redirect: 'manual',
    }),
  );
}

/**
 * Where git should go when `<owner>` is a handle its person retired: the same path and query
 * under the new handle. Git follows a redirect on its first request (`info/refs`) and uses the
 * new base for the rest, so an old remote keeps cloning and pushing.
 */
export function movedGitLocation(requestUrl: string, from: string, to: string): string {
  const url = new URL(requestUrl);
  const [, first = '', ...rest] = url.pathname.split('/');
  if (decodeURIComponent(first).toLowerCase() !== from.toLowerCase()) return url.toString();
  url.pathname = ['', encodeURIComponent(to), ...rest].join('/');
  return url.toString();
}
