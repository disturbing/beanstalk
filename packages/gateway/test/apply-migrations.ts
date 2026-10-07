import { applyD1Migrations, env } from 'cloudflare:test';
import { z } from 'zod';

/** Applies the registry's migrations (read by vitest.config.ts) before every test file. */
const Migrations = z.array(z.object({ name: z.string(), queries: z.array(z.string()) }));

await applyD1Migrations(env.FORGE, Migrations.parse(JSON.parse(String(Reflect.get(env, 'TEST_MIGRATIONS')))));
