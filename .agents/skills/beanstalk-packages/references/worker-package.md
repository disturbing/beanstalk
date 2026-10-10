# Worker package template

## Contents
- package.json
- wrangler.jsonc
- tsconfig.json and test typings
- vitest.config.ts
- src/index.ts and src/app.ts
- First e2e test
- Shared library variant

## package.json

```json
{
  "name": "@gitstalk/gateway",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "types": "wrangler types",
    "typecheck": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@hono/zod-validator": "catalog:",
    "hono": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:",
    "wrangler": "catalog:"
  }
}
```

## wrangler.jsonc

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "beanstalk-gateway",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-03",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true, "traces": { "enabled": true } },
  "vars": { "LOG_LEVEL": "info" },
  // Durable Object classes exported from src/index.ts. `exports` replaces `migrations`.
  "exports": {
    "LeaseBoard": { "type": "durable-object", "storage": "sqlite" }
  },
  "durable_objects": {
    "bindings": [{ "name": "LEASES", "class_name": "LeaseBoard" }]
  },
  "services": [{ "binding": "INTEGRATOR", "service": "beanstalk-integrator" }],
  "artifacts": [{ "binding": "ARTIFACTS", "namespace": "default" }],
  "queues": {
    "producers": [{ "binding": "PUSH_EVENTS", "queue": "beanstalk-push-events" }],
    "consumers": [{ "queue": "beanstalk-push-events", "max_batch_size": 10, "max_retries": 3, "dead_letter_queue": "beanstalk-push-events-dlq" }]
  }
}
```

Keep only the bindings the Worker uses. Secrets go in `.dev.vars` locally and `wrangler secret put` remotely, never in `vars`. After any binding change run `pnpm -F @gitstalk/<name> types` and commit the regenerated `worker-configuration.d.ts`.

## tsconfig.json and test typings

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["./worker-configuration.d.ts", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "worker-configuration.d.ts"]
}
```

`test/env.d.ts` gives `env` from `cloudflare:test` the generated binding type:

```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
```

## vitest.config.ts

```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    poolOptions: {
      workers: {
        wrangler: { configPath: './wrangler.jsonc' },
        isolatedStorage: true,
      },
    },
  },
});
```

## src/index.ts and src/app.ts

```ts
// src/index.ts
import { WorkerEntrypoint } from 'cloudflare:workers';
import { createApp } from './app';
import { createDeps } from './deps';

export { LeaseBoard } from './lease/lease-board';

export default class Gateway extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const app = createApp(createDeps(this.env));
    return app.fetch(request, this.env, this.ctx);
  }

  // RPC surface for other Workers (service bindings). Keep it small and typed.
  async claimIntent(intentId: string, agentId: string): Promise<{ sproutId: string }> {
    return createDeps(this.env).intents.claim(intentId, agentId);
  }
}
```

```ts
// src/app.ts
import { Hono } from 'hono';
import { requestId } from './middleware/request-id';
import { onError } from './middleware/on-error';
import { beans } from './routes/beans';
import { worlds } from './routes/worlds';
import type { Deps } from './deps';

export type AppEnv = {
  Bindings: Env;
  Variables: { requestId: string; deps: Deps };
};

export function createApp(deps: Deps) {
  const app = new Hono<AppEnv>();
  app.use(requestId());
  app.use(async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.route('/beans', beans);
  app.route('/worlds', worlds);
  app.onError(onError);
  return app;
}

export type AppType = ReturnType<typeof createApp>;
```

`createDeps(env)` builds the adapters (Artifacts wrapper, queue producer, clock) once per request; it is cheap and keeps domain code free of `env`.

## First e2e test

```ts
// test/healthz.test.ts
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('gateway', () => {
  it('answers the health check', async () => {
    const response = await SELF.fetch('https://gateway.test/healthz');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
```

## Shared library variant

`packages/shared-<topic>` has `package.json` with `"exports": { ".": "./src/index.ts" }` (source is consumed directly by the Workers bundler), `tsconfig.json` extending the base, `typecheck` and `test` scripts, no wrangler config. Consumers add `"@gitstalk/shared-<topic>": "workspace:*"`. A shared library never imports `cloudflare:workers` types that bind it to one Worker's `Env`; it receives ports as parameters.
