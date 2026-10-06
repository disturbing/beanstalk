import { Container } from '@cloudflare/containers';
import type { StopParams } from '@cloudflare/containers';

import { createLogger } from '../log';

/** How long an idle runner instance stays up (and billed) after its last request. */
export const RUNNER_SLEEP_AFTER_SECONDS = 120;

const log = createLogger('info', { component: 'runner-container' });

/**
 * The `runner` container (packages/runner): git, Node and Mergiraf behind the §3 HTTP API.
 * One instance per run commits (squash, update-ref); one per emulated CI slot runs suites.
 *
 * Internet egress is on because the runner must reach the Artifacts git remotes over HTTPS:
 * an `allowedHosts` list only filters intercepted traffic, and intercepting HTTPS needs the
 * image to trust Cloudflare's container CA, which the runner image does not install yet.
 */
export class Runner extends Container<Env> {
  override defaultPort = 8080;
  override sleepAfter = `${RUNNER_SLEEP_AFTER_SECONDS}s`;
  override enableInternet = true;
  override envVars = {
    PORT: '8080',
    WORK_DIR: '/work',
    REMOTE_SCHEMES: 'https',
    RUST_LOG: 'info',
  };

  override onStart(): void {
    log.info('runner container started', { instance: this.ctx.id.toString() });
  }

  override onStop(params: StopParams): void {
    log.info('runner container stopped', { instance: this.ctx.id.toString(), ...params });
  }

  override onError(error: unknown): never {
    log.error('runner container failed', { instance: this.ctx.id.toString(), error });
    throw error;
  }
}
