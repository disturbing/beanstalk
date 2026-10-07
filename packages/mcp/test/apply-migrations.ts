import { applyD1Migrations, env } from 'cloudflare:test';

/** The identity and registry migrations (read by vitest.config.ts), applied per test file. */
const identity: unknown = Reflect.get(env, 'TEST_MIGRATIONS');
const forge: unknown = Reflect.get(env, 'FORGE_MIGRATIONS');
const forgeDb: unknown = Reflect.get(env, 'FORGE');
if (!Array.isArray(identity) || !Array.isArray(forge) || !isD1(forgeDb))
  throw new Error('vitest.config.ts passes TEST_MIGRATIONS, FORGE_MIGRATIONS and FORGE');
await Promise.all([
  applyD1Migrations(env.IDENTITY_DB, identity),
  applyD1Migrations(forgeDb, forge),
]);

function isD1(value: unknown): value is D1Database {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'prepare') === 'function'
  );
}
