import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Tests run the Worker on Miniflare. The gateway is not started: requests that reach it use
 * a fake GATEWAY (test/fake-gateway.ts) answering from a recorded run, handed to the app as
 * its dependency; the binding itself answers 503 so nothing leaves the test.
 *
 * `@cloudflare/vitest-pool-workers` 0.22 bundles a workerd that may not know today's
 * compatibility date, so the tests use the newest date it supports (as the gateway's do).
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      remoteBindings: false,
      miniflare: {
        compatibilityDate: poolWorkerdCompatibilityDate(),
        bindings: { LOG_LEVEL: 'error' },
        serviceBindings: {
          GATEWAY: () => new Response('no gateway in tests', { status: 503 }),
        },
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});

/** The compatibility date of the workerd the test pool runs (pool → miniflare → workerd). */
function poolWorkerdCompatibilityDate(): string {
  const fromPool = createRequire(
    fileURLToPath(import.meta.resolve('@cloudflare/vitest-pool-workers')),
  );
  const fromMiniflare = createRequire(fromPool.resolve('miniflare'));
  const workerd: unknown = fromMiniflare('workerd');
  if (typeof workerd === 'object' && workerd !== null && 'compatibilityDate' in workerd) {
    const date = workerd.compatibilityDate;
    if (typeof date === 'string') return date;
  }
  throw new Error('cannot read the test pool workerd compatibility date');
}
