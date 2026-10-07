import { applyD1Migrations, env } from 'cloudflare:test';

/** The identity and registry migrations (read by vitest.config.ts), applied per test file. */
const identity: unknown = Reflect.get(env, 'TEST_MIGRATIONS');
const registry: unknown = Reflect.get(env, 'FORGE_MIGRATIONS');
if (!Array.isArray(identity) || !Array.isArray(registry))
  throw new Error('vitest.config.ts passes TEST_MIGRATIONS and FORGE_MIGRATIONS');
await Promise.all([
  applyD1Migrations(env.IDENTITY_DB, identity),
  applyD1Migrations(env.FORGE, registry),
]);
