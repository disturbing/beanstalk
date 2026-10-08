/**
 * beanstalk-actions-spike (throwaway): does `act` in host mode run real workflows on a
 * Cloudflare Container? One container class (ActRunner, own DO namespace), one instance per
 * `?instance=` name. Not part of the build; torn down after the spike.
 *
 *   GET  /health?instance=x   time a container start (cold) or a warm round trip
 *   POST /run?instance=x      body forwarded to the container's /run: act output streamed back
 *   POST /exec?instance=x     body forwarded to the container's /exec (probes: dockerd, df, …)
 *   POST /stop?instance=x     stop the instance
 *   ANY  /<owner>/<repo>[.git]/(info/refs|git-upload-pack)
 *                             GitHub-shaped git host: rewritten to the live gateway's
 *                             /git/<owner>/<repo>.git/… . actions/checkout builds its remote as
 *                             `${origin(github-server-url)}/${owner}/${repo}` (any path in the
 *                             server URL is dropped, and there is no `.git`), so git must be
 *                             served at the root of a host.
 *
 * Every other route needs `authorization: Bearer <SPIKE_TOKEN>`.
 */
import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  ACT_RUNNER: DurableObjectNamespace<ActRunner>;
  SPIKE_TOKEN: string;
  GATEWAY_ORIGIN: string;
}

export class ActRunner extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = '15m';
  override enableInternet = true;

  override onStart(): void {
    console.log(JSON.stringify({ msg: 'act container started', id: this.ctx.id.toString() }));
  }

  override onStop(params: unknown): void {
    console.log(JSON.stringify({ msg: 'act container stopped', params }));
  }
}

const GIT_PATH = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/(info\/refs|git-upload-pack)$/;

async function gitProxy(request: Request, env: Env, url: URL): Promise<Response> {
  const match = GIT_PATH.exec(url.pathname);
  if (match === null) return new Response('bad git path\n', { status: 400 });
  const [, owner, repo, rest] = match;
  const target = new URL(`/git/${owner}/${repo}.git/${rest}${url.search}`, env.GATEWAY_ORIGIN);
  const headers = new Headers(request.headers);
  headers.delete('host');
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.body,
    redirect: 'manual',
  });
  console.log(
    JSON.stringify({ msg: 'git proxy', method: request.method, path: target.pathname, status: upstream.status }),
  );
  return upstream;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (GIT_PATH.test(url.pathname)) return gitProxy(request, env, url);
    if (request.headers.get('authorization') !== `Bearer ${env.SPIKE_TOKEN}`)
      return new Response('unauthorized\n', { status: 401 });
    const instance = url.searchParams.get('instance') ?? 'default';
    const container = getContainer(env.ACT_RUNNER, instance);
    if (url.pathname === '/stop') {
      await container.stop();
      return Response.json({ stopped: instance });
    }
    if (url.pathname === '/health') {
      const t0 = Date.now();
      const res = await container.fetch(new Request('http://container/health'));
      const inner = await res.text();
      return Response.json({ worker_round_trip_ms: Date.now() - t0, inner: JSON.parse(inner) });
    }
    if (url.pathname === '/run' || url.pathname === '/exec') {
      // The container's response body is a stream; returning it as-is streams act's output to the
      // caller as it is produced (no buffering in the Worker or the DO).
      return container.fetch(
        new Request(`http://container${url.pathname}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: request.body,
        }),
      );
    }
    return new Response('not found\n', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
