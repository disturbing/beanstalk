import { applyD1Migrations, env } from 'cloudflare:test';

const migrations: unknown = Reflect.get(env, 'TEST_MIGRATIONS');
if (!Array.isArray(migrations)) throw new Error('vitest.config.ts passes TEST_MIGRATIONS');
await applyD1Migrations(env.IDENTITY_DB, migrations);
