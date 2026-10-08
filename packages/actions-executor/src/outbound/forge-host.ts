/**
 * `bs.internal`, the job's `GITHUB_SERVER_URL`. `actions/checkout` clones
 * `<server>/<owner>/<repo>` and act fetches every `uses:` action from `<server>/<owner>/<repo>`,
 * so one virtual host serves both:
 *
 * - the job's own repository goes to the gateway's smart-HTTP git (`/git/<owner>/<repo>.git/…`)
 *   over the service binding, with the job token the container sent (checkout's
 *   `basic x-access-token:<token>` header);
 * - any other repository is a public action: fetched from github.com anonymously, read-only,
 *   with the job token removed, so a Beanstalk token never reaches GitHub;
 * - `/api/…` (the GitHub REST API) is not served yet: 501 with the reason.
 */

export type ForgeJob = {
  /** `owner/repo`, as the job's `GITHUB_REPOSITORY`. */
  readonly repository: string;
  /** The gateway's git URL for it (`https://<gateway>/git/<owner>/<repo>.git`). */
  readonly checkoutUrl: string;
};

export type ForgeRoute =
  | { readonly kind: 'repository'; readonly url: string }
  | { readonly kind: 'action'; readonly url: string }
  | { readonly kind: 'refused'; readonly status: number; readonly reason: string };

const GIT_PATH =
  /^\/([A-Za-z0-9_.-]{1,100})\/([A-Za-z0-9_.-]{1,100}?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/;

/** Where a request from the job to `bs.internal` goes. */
export function routeForgeRequest(url: URL, job: ForgeJob): ForgeRoute {
  if (url.pathname.startsWith('/api/')) {
    return {
      kind: 'refused',
      status: 501,
      reason: 'Beanstalk does not serve the GitHub REST API to jobs yet',
    };
  }
  const match = GIT_PATH.exec(url.pathname);
  const [, owner, repo, rest] = match ?? [];
  if (owner === undefined || repo === undefined || rest === undefined) {
    return { kind: 'refused', status: 404, reason: 'not a git smart-HTTP path' };
  }
  if (`${owner}/${repo}`.toLowerCase() === job.repository.toLowerCase()) {
    return { kind: 'repository', url: `${job.checkoutUrl}/${rest}${url.search}` };
  }
  const isRead =
    rest === 'git-upload-pack' ||
    (rest === 'info/refs' && url.searchParams.get('service') === 'git-upload-pack');
  if (!isRead) {
    return { kind: 'refused', status: 403, reason: 'actions from github.com are read-only' };
  }
  return { kind: 'action', url: `https://github.com/${owner}/${repo}.git/${rest}${url.search}` };
}

/** Headers git needs, and nothing else; `keepAuthorization` only toward Beanstalk. */
export function gitHeaders(request: Request, keepAuthorization: boolean): Headers {
  const headers = new Headers();
  const names = ['content-type', 'accept', 'git-protocol', 'content-encoding', 'user-agent'];
  if (keepAuthorization) names.push('authorization');
  for (const name of names) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  if (!headers.has('user-agent')) headers.set('user-agent', 'git/2.43.0 (beanstalk-actions)');
  return headers;
}

/** Answers one `bs.internal` request: the gateway for the repository, github.com for actions. */
export async function answerForge(
  request: Request,
  job: ForgeJob,
  gateway: { fetch(request: Request): Promise<Response> },
): Promise<Response> {
  const route = routeForgeRequest(new URL(request.url), job);
  if (route.kind === 'refused') {
    return Response.json({ message: route.reason }, { status: route.status });
  }
  const forwarded = new Request(route.url, {
    method: request.method,
    headers: gitHeaders(request, route.kind === 'repository'),
    body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
    redirect: 'manual',
  });
  return route.kind === 'repository' ? gateway.fetch(forwarded) : fetch(forwarded);
}
