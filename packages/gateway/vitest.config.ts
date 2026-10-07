import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

/**
 * Tests run the real Worker and RunDO on Miniflare. Two bindings have no local simulator:
 * Artifacts (remote only) and the runner container (needs Docker). The tests use
 * wrangler.jsonc without those two blocks, bind ARTIFACTS to a fake Artifacts worker that
 * also serves the git remotes the proxy forwards to (all outbound fetches go there), and
 * point RUNNER at a fake runner Durable Object. No test touches the network.
 *
 * `@cloudflare/vitest-pool-workers` 0.22 (the last release before its rename to
 * `@cloudflare/vitest-plugin`) bundles a workerd that does not know today's compatibility
 * date, so the test config uses the newest date that workerd supports.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const compatibilityDate = poolWorkerdCompatibilityDate();
/** The registry's D1 migrations, applied to the test database by test/apply-migrations.ts. */
const migrations = await readD1Migrations(path.join(here, 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: writeTestWranglerConfig() },
      remoteBindings: false,
      miniflare: {
        bindings: {
          ADMIN_TOKEN: 'test-admin-token-0123456789abcdef0123456789',
          RUN_TOKEN_SECRET: 'test-run-token-secret-0123456789abcdef0123',
          LOG_LEVEL: 'error',
          TEST_MIGRATIONS: JSON.stringify(migrations),
        },
        serviceBindings: { ARTIFACTS: { name: 'fake-artifacts', entrypoint: 'FakeArtifacts' } },
        durableObjects: { RUNNER: { className: 'FakeRunner', scriptName: 'fake-runner' } },
        outboundService: { name: 'fake-artifacts', entrypoint: 'FakeGitRemote' },
        workers: [
          {
            name: 'fake-artifacts',
            modules: true,
            scriptPath: path.join(here, 'test/fakes/fake-artifacts.js'),
            compatibilityDate,
          },
          {
            name: 'fake-runner',
            modules: true,
            scriptPath: path.join(here, 'test/fakes/fake-runner.js'),
            compatibilityDate,
            durableObjects: { FAKE_RUNNER: { className: 'FakeRunner', useSQLite: true } },
          },
        ],
      },
    }),
  ],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    setupFiles: ['./test/apply-migrations.ts'],
  },
});

/**
 * wrangler.jsonc without `containers` and `artifacts` (and `secrets`: the bindings above
 * supply them), written under .wrangler/ (ignored).
 */
function writeTestWranglerConfig(): string {
  const config: Record<string, unknown> = JSON.parse(
    withoutJsoncSyntax(readFileSync(path.join(here, 'wrangler.jsonc'), 'utf8')),
  );
  delete config['containers'];
  delete config['artifacts'];
  delete config['secrets'];
  delete config['$schema'];
  config['main'] = path.join(here, 'src/index.ts');
  if (
    typeof config['compatibility_date'] === 'string' &&
    config['compatibility_date'] > compatibilityDate
  ) {
    config['compatibility_date'] = compatibilityDate;
  }
  const directory = path.join(here, '.wrangler', 'test');
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, 'wrangler.test.json');
  writeFileSync(file, JSON.stringify(config, null, 2));
  return file;
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

/** Drops comments and trailing commas outside strings, turning JSONC into JSON. */
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
