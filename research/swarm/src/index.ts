import { WorkerEntrypoint } from 'cloudflare:workers';

import { createApp } from './app';

export { AgentSandbox } from './agent/agent-sandbox';
export { BrokerDO } from './broker/broker-do';
export { MatchDO } from './match/match-do';
// Required by @cloudflare/containers: the outbound handlers run in this entrypoint.
export { ContainerProxy } from '@cloudflare/containers';

const app = createApp();

/**
 * beanstalk-swarm: Codex agents (or replay agents) in Cloudflare containers, one per gateway
 * slot, driven by the race driver's single-slot mode (research/race/harness/slot.py). Design:
 * docs/claude-opus/17-cloud-agent-swarm.md (phase 1: the Gitstalk arm).
 */
export default class Swarm extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }
}
