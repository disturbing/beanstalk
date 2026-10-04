import { loadConfig } from './config.ts';
import { openDatabase } from './db/migrate.ts';
import { systemClock } from './lib/clock.ts';
import { createMemoryMailer } from './notifications/queue.ts';
import { Router } from './router.ts';
import type { Request, Response } from './router.ts';
import { registerRoutes } from './routes.ts';
import type { AppContext } from './types.ts';

export interface App {
  ctx: AppContext;
  router: Router;
  handle(req: Partial<Request> & { method: string; path: string }): Response;
}

/** Wire up config, an in-memory database, the mailer and every route. */
export function createApp(overrides: Partial<AppContext> = {}): App {
  const ctx: AppContext = {
    config: overrides.config ?? loadConfig(),
    store: overrides.store ?? openDatabase(),
    clock: overrides.clock ?? systemClock,
    mailer: overrides.mailer ?? createMemoryMailer(),
  };
  const router = new Router();
  registerRoutes(router);
  return { ctx, router, handle: (req) => router.handle(ctx, req) };
}
