import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

import { TEST_REQUEST_SECRET } from './test/constants.ts';

/**
 * The real Worker on Miniflare with throwaway secrets generated here for the test run (never
 * written anywhere). The pool's workerd may not know today's compatibility date.
 */
const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
]);
const privateJwk = await webcrypto.subtle.exportKey('jwk', pair.privateKey);
const signingKeys = JSON.stringify({
  active: 'worker-test',
  keys: [{ ...privateJwk, kid: 'worker-test', alg: 'ES256' }],
});

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        compatibilityDate: poolWorkerdCompatibilityDate(),
        bindings: { OIDC_SIGNING_KEYS: signingKeys, OIDC_REQUEST_SECRET: TEST_REQUEST_SECRET },
      },
    }),
  ],
  test: { include: ['test/**/*.test.ts'] },
});

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
