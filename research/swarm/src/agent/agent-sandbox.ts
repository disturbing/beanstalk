import { Container } from '@cloudflare/containers';
import type { OutboundHandlerContext, StopParams } from '@cloudflare/containers';

import { loggerFor } from '../config';
import type { Logger } from '../log';
import type { AgentAssignment } from './assignment';
import { MODEL_HOST } from './codex-provider';
import {
  CONTROL_HOST,
  GATEWAY_HOST,
  serveControl,
  serveGateway,
  serveModel,
} from './virtual-hosts';
import type { HostDeps } from './virtual-hosts';

/** How long a container may go without any request to a virtual host before it is stopped. */
const SLEEP_AFTER = '30m';

/**
 * One agent container (agent/Dockerfile: Codex CLI + the race driver in single-slot mode).
 * No internet: the only names its resolver answers are the three virtual hosts, served by
 * the handlers below in this Worker, which add the slot token or model credential themselves.
 */
export class AgentSandbox extends Container<Env> {
  override sleepAfter = SLEEP_AFTER;
  override enableInternet = false;
  readonly #log: Logger;

  constructor(ctx: Container<Env>['ctx'], env: Env) {
    super(ctx, env);
    this.#log = loggerFor(env, 'agent-sandbox');
  }

  async begin(assignment: AgentAssignment): Promise<void> {
    this.ctx.storage.kv.put('assignment', assignment);
    await this.start({
      envVars: { SWARM_CONTROL_URL: `http://${CONTROL_HOST}`, SWARM_SLOT: assignment.slot },
      enableInternet: false,
    });
    this.#log.info('agent container starting', { match: assignment.match, slot: assignment.slot });
  }

  assignment(): AgentAssignment | null {
    return this.ctx.storage.kv.get<AgentAssignment>('assignment') ?? null;
  }

  setToken(token: string): void {
    const current = this.assignment();
    if (current !== null) this.ctx.storage.kv.put('assignment', { ...current, token });
  }

  touch(): void {
    this.renewActivityTimeout();
  }

  async halt(): Promise<void> {
    const state = await this.getState();
    if (state.status === 'running' || state.status === 'healthy') await this.destroy();
  }

  override async onStop(params: StopParams): Promise<void> {
    const assignment = this.assignment();
    this.#log.info('agent container stopped', { slot: assignment?.slot, ...params });
    if (assignment === null) return;
    const match = this.env.MATCHES.get(this.env.MATCHES.idFromName(assignment.match));
    await match.slotExited(assignment.slot, params.exitCode, params.reason);
  }

  override onError(error: unknown): never {
    this.#log.error('agent container failed', { error });
    throw error;
  }
}

function deps(env: Env, ctx: OutboundHandlerContext): HostDeps {
  const agent = env.AGENTS.get(env.AGENTS.idFromString(ctx.containerId));
  return {
    env,
    agent,
    matchOf: (match) => env.MATCHES.get(env.MATCHES.idFromName(match)),
    broker: env.BROKER.get(env.BROKER.idFromName('broker')),
    gateway: env.GATEWAY,
    // A bare `fetch` called as a method of this object throws "Illegal invocation".
    upstream: (request) => fetch(request),
  };
}

AgentSandbox.outboundByHost = {
  [CONTROL_HOST]: (request, env, ctx) => serveControl(request, deps(env, ctx)),
  [GATEWAY_HOST]: (request, env, ctx) => serveGateway(request, deps(env, ctx)),
  [MODEL_HOST]: (request, env, ctx) => serveModel(request, deps(env, ctx)),
};
