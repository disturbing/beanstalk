import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * The library runs in workerd against a real R2 bucket (Miniflare). The pool's workerd may not
 * know today's compatibility date, so tests use the newest it supports (as the other packages'
 * do).
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/wrangler.jsonc' },
      miniflare: { compatibilityDate: poolWorkerdCompatibilityDate() },
    }),
  ],
  test: { include: ['test/**/*.test.ts'] },
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
