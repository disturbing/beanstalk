import { Container } from '@cloudflare/containers';
import type { StopParams } from '@cloudflare/containers';

import { readConfig } from './config';
import type { SshConfig } from './config';
import { gatewaySsh, routeOutbound } from './gateway-outbound';
import { createLogger } from './log';
import type { Logger } from './log';
import type { Duplex } from './socket-pipe';
import { pipeBothWays } from './socket-pipe';
import { webSocketDuplex } from './tunnel';

/** The SSH server's ports in the container: SSH, and HTTP for the readiness probe. */
export const SSH_PORT = 2222;
export const HEALTH_PORT = 8080;
/** The test tunnel's path, on the Worker and on the object it forwards to. */
export const TUNNEL_PATH = '/tunnel';
/** A connection's whole life, a little over the SSH server's own limit (it closes first). */
const MAX_CONNECTION_MS = 65 * 60 * 1000;
/** How often a live connection renews the container's sleep timer. */
const ACTIVITY_RENEW_MS = 30_000;

/**
 * Answers the container's request to `gateway.internal`. A failure is logged here and reaches
 * the SSH server as a bare 502, so no internal detail is ever shown to a git client.
 */
async function answerContainer(request: Request, env: Env): Promise<Response> {
  const gateway = gatewaySsh(env.GATEWAY);
  if (gateway === null) return new Response('the gateway has no SSH methods\n', { status: 503 });
  try {
    return await routeOutbound(request, gateway);
  } catch (error) {
    const log = createLogger(readConfig(env).logLevel, { component: 'ssh-outbound' });
    log.error('gateway call failed', { path: new URL(request.url).pathname, error });
    return new Response('the gateway failed\n', { status: 502 });
  }
}

/**
 * One SSH server container (packages/ssh-server), owned by this Durable Object. The Worker's
 * `connect` handler opens a TCP connection to the object (`stub.connect`); the object forwards
 * it to the container's SSH port, counting bytes and refusing connections beyond its budget.
 * The container's outbound traffic is allowed to one host, `gateway.internal`, answered by the
 * gateway over the service binding (`gateway-outbound.ts`).
 */
export class SshServer extends Container<Env> {
  override defaultPort = HEALTH_PORT;
  override sleepAfter = '15m';
  override enableInternet = false;
  readonly #config: SshConfig;
  readonly #log: Logger;
  #open = 0;

  // A static block, not a field: the library registers handlers through the setter.
  static {
    this.outboundByHost = { 'gateway.internal': answerContainer };
  }

  constructor(ctx: Container<Env>['ctx'], env: Env) {
    super(ctx, env);
    this.#config = readConfig(env);
    this.#log = createLogger(this.#config.logLevel, { component: 'ssh-server' });
    this.envVars = {
      SSH_HOST_KEY: env.SSH_HOST_KEY,
      SSH_PORT: String(SSH_PORT),
      PORT: String(HEALTH_PORT),
      GATEWAY_URL: 'http://gateway.internal',
      MAX_SESSIONS: String(this.#config.maxConnections),
      RUST_LOG: this.#config.logLevel,
    };
  }

  /** One inbound SSH connection (from the Worker's `connect`), forwarded to the container. */
  override async connect(socket: Socket): Promise<void> {
    await this.#serve(socket, () => socket.close());
  }

  /**
   * `GET /tunnel` (test stacks only; the Worker checks SSH_TUNNEL): the WebSocket is accepted
   * here, in the object that owns the container, so both directions live as long as it does.
   */
  override async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== TUNNEL_PATH) return super.fetch(request);
    const [client, server] = Object.values(new WebSocketPair());
    if (client === undefined || server === undefined)
      return new Response('no websocket', { status: 500 });
    server.accept();
    this.ctx.waitUntil(this.#serve(webSocketDuplex(server), () => server.close(1011, 'failed')));
    return new Response(null, { status: 101, webSocket: client });
  }

  async #serve(client: Duplex, abandon: () => unknown): Promise<void> {
    const connection = crypto.randomUUID();
    if (this.#open >= this.#config.maxConnections) {
      this.#log.warn('ssh connection refused: instance full', { connection, open: this.#open });
      await Promise.resolve(abandon()).catch(() => undefined);
      return;
    }
    this.#open += 1;
    const startedMs = Date.now();
    try {
      const totals = await this.#forward(client);
      this.#log.info('ssh connection closed', {
        connection,
        ...totals,
        seconds: Math.round((Date.now() - startedMs) / 1000),
      });
    } catch (error) {
      this.#log.error('ssh connection failed', { connection, error });
      await Promise.resolve(abandon()).catch(() => undefined);
    } finally {
      this.#open -= 1;
    }
  }

  async #forward(client: Duplex): Promise<{ bytesIn: number; bytesOut: number }> {
    const container = this.ctx.container;
    if (container === undefined) throw new Error('this Durable Object has no container');
    await this.startAndWaitForPorts(HEALTH_PORT).catch((error: unknown) => {
      // A cold start can fail once (an instance being replaced); the client is still waiting.
      this.#log.warn('ssh container start failed; retrying once', { error });
      return this.startAndWaitForPorts(HEALTH_PORT);
    });
    const upstream = container.getTcpPort(SSH_PORT).connect(`10.0.0.1:${SSH_PORT}`);
    await upstream.opened;
    let renewedMs = 0;
    return pipeBothWays(client, upstream, {
      signal: AbortSignal.timeout(MAX_CONNECTION_MS),
      onActivity: () => {
        if (Date.now() - renewedMs < ACTIVITY_RENEW_MS) return;
        renewedMs = Date.now();
        this.renewActivityTimeout();
      },
    });
  }

  override onStart(): void {
    this.#log.info('ssh container started', { instance: this.ctx.id.toString() });
  }

  override onStop(params: StopParams): void {
    this.#log.info('ssh container stopped', { instance: this.ctx.id.toString(), ...params });
  }

  override onError(error: unknown): never {
    this.#log.error('ssh container failed', { instance: this.ctx.id.toString(), error });
    throw error;
  }
}
