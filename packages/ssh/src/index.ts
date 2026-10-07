import { WorkerEntrypoint } from 'cloudflare:workers';
import { Hono } from 'hono';

import { poolInstance, readConfig } from './config';
import { createLogger } from './log';
import type { Duplex } from './socket-pipe';
import { pipeBothWays } from './socket-pipe';
import { SSH_PORT, TUNNEL_PATH } from './ssh-server';

export { SshServer } from './ssh-server';
// Required by @cloudflare/containers for outbound interception (gateway.internal).
export { ContainerProxy } from '@cloudflare/containers';

/** The Worker's own bound on a connection it forwards (the SSH server closes first). */
const MAX_CONNECTION_MS = 66 * 60 * 1000;

type AppEnv = { Bindings: Env; Variables: Record<string, never> };

/**
 * beanstalk-ssh: git over SSH (docs/claude-opus/21-git-over-ssh.md). `connect` takes the TCP
 * connections Spectrum routes here (port 22 of the SSH hostname) and forwards each to one of the
 * pool's SshServer Durable Objects; `fetch` answers health, the host key's fingerprint and,
 * on a test stack, the WebSocket tunnel.
 */
export default class SshWorker extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Response | Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  override async connect(socket: Socket): Promise<void> {
    await forward(socket, this.env);
  }
}

const app = new Hono<AppEnv>()
  .get('/healthz', (c) => c.json({ ok: true }))
  .get('/host-key', (c) => {
    const { hostKeyFingerprint } = readConfig(c.env);
    if (hostKeyFingerprint === '') return c.json({ error: 'no host key fingerprint set' }, 404);
    return c.json({ fingerprint: hostKeyFingerprint, user: 'git', port: 22 });
  })
  .get(TUNNEL_PATH, (c) => {
    const config = readConfig(c.env);
    if (config.tunnel !== 'on') return c.notFound();
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket')
      return c.text('expected a WebSocket upgrade', 426);
    // Accepted by the object that owns the container: a WebSocket bridged here would live only
    // as long as this request's waitUntil (pushes held with -o wait outlast it).
    return c.env.SSH_SERVERS.getByName(poolInstance(config.poolSize)).fetch(c.req.raw);
  })
  .notFound((c) => c.text('not found', 404));

/** Forwards one inbound TCP connection to a pool instance's SSH server. */
async function forward(client: Duplex, env: Env): Promise<void> {
  const config = readConfig(env);
  const log = createLogger(config.logLevel, { component: 'ssh-ingress' });
  const instance = poolInstance(config.poolSize);
  const upstream = env.SSH_SERVERS.getByName(instance).connect(`ssh-server:${SSH_PORT}`);
  const startedMs = Date.now();
  const totals = await pipeBothWays(client, upstream, {
    signal: AbortSignal.timeout(MAX_CONNECTION_MS),
    onActivity: () => undefined,
  });
  log.info('ssh ingress closed', {
    instance,
    ...totals,
    seconds: Math.round((Date.now() - startedMs) / 1000),
  });
}
