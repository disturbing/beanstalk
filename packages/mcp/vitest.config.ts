import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';
import { z } from 'zod';

/**
 * Tests run the MCP Worker and gateway over a real service binding, with the gateway's
 * SQLite RunDO and RunIndex. Existing recorded-fixture tests still inject their own source.
 * Artifacts has no local simulator and the runner needs Docker: reuse the gateway suite's
 * stand-ins for those external services. No run is started and no test leaves Miniflare.
 * The local MCP configuration removes remote AI; production configuration is untouched.
 *
 * `@cloudflare/vitest-pool-workers` 0.22 bundles a workerd that may not know today's
 * compatibility date, so the tests use the newest date it supports (as the gateway's do).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const compatibilityDate = poolWorkerdCompatibilityDate();
const gatewayScript = bundleGateway();

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: writeTestWranglerConfig() },
      remoteBindings: false,
      miniflare: {
        compatibilityDate,
        bindings: { LOG_LEVEL: 'error' },
        serviceBindings: {
          GATEWAY: 'beanstalk-gateway',
        },
        workers: auxiliaryWorkers(),
      },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});

function auxiliaryWorkers() {
  const gateway = path.join(here, '../gateway');
  // Inline external fixtures: the pool resolves auxiliary module paths from the MCP root.
  return [
    {
      name: 'beanstalk-gateway',
      modules: true,
      scriptPath: gatewayScript,
      compatibilityDate,
      compatibilityFlags: ['nodejs_compat'],
      bindings: {
        ADMIN_TOKEN: 'mcp-test-admin-token-0123456789abcdef',
        RUN_TOKEN_SECRET: 'mcp-test-signing-secret-0123456789abcdef',
        LOG_LEVEL: 'error',
        ARTIFACTS_NAMESPACE: 'beanstalk-race',
        RUN_TOKEN_TTL_SECONDS: '3600',
        ARTIFACTS_TOKEN_TTL_SECONDS: '600',
      },
      serviceBindings: { ARTIFACTS: { name: 'fake-artifacts', entrypoint: 'FakeArtifacts' } },
      durableObjects: {
        RUNS: { className: 'RunDO', useSQLite: true },
        RUN_INDEX: { className: 'RunIndex', useSQLite: true },
        RUNNER: { className: 'FakeRunner', scriptName: 'fake-runner' },
      },
      outboundService: { name: 'fake-artifacts', entrypoint: 'FakeGitRemote' },
    },
    {
      name: 'fake-artifacts',
      modules: true,
      script: readFileSync(path.join(gateway, 'test/fakes/fake-artifacts.js'), 'utf8'),
      compatibilityDate,
    },
    {
      name: 'fake-runner',
      modules: true,
      script: readFileSync(path.join(gateway, 'test/fakes/fake-runner.js'), 'utf8'),
      compatibilityDate,
      durableObjects: { FAKE_RUNNER: { className: 'FakeRunner', useSQLite: true } },
    },
  ];
}

/** Bundle actual production code using the esbuild already installed with Wrangler. */
function bundleGateway(): string {
  const fromWrangler = createRequire(fileURLToPath(import.meta.resolve('wrangler')));
  const esbuild: unknown = fromWrangler('esbuild');
  if (typeof esbuild !== 'object' || esbuild === null)
    throw new Error('Wrangler has no esbuild module');
  const buildSync: unknown = Reflect.get(esbuild, 'buildSync');
  if (typeof buildSync !== 'function') throw new Error('Wrangler esbuild has no buildSync');
  const directory = path.join(here, '.wrangler/test');
  mkdirSync(directory, { recursive: true });
  const outfile = path.join(directory, 'gateway.js');
  Reflect.apply(buildSync, esbuild, [
    {
      entryPoints: [path.join(here, '../gateway/src/index.ts')],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2024',
      conditions: ['workerd', 'worker', 'browser'],
      external: ['cloudflare:*', 'workerd:*', 'node:*', ...builtinModules],
    },
  ]);
  return outfile;
}

function writeTestWranglerConfig(): string {
  const config = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(withoutJsoncSyntax(readFileSync(path.join(here, 'wrangler.jsonc'), 'utf8'))));
  delete config['ai'];
  delete config['$schema'];
  config['main'] = path.join(here, 'src/index.ts');
  config['compatibility_date'] = compatibilityDate;
  const file = path.join(here, '.wrangler/test/wrangler.test.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
}

/** Drop JSONC comments only outside quoted strings. */
function withoutJsoncSyntax(text: string): string {
  let output = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index] ?? '';
    const pair = text.slice(index, index + 2);
    if (char === '"') {
      const end = stringEnd(text, index);
      output += text.slice(index, end);
      index = end;
    } else if (pair === '//') {
      index = text.indexOf('\n', index) === -1 ? text.length : text.indexOf('\n', index);
    } else if (pair === '/*') {
      index = text.indexOf('*/', index) + 2;
    } else {
      output += char;
      index += 1;
    }
  }
  return output.replace(/,(\s*[}\]])/g, '$1');
}

function stringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === '\\' ? 2 : 1;
  return index + 1;
}

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
