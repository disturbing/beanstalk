import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { ZodError } from 'zod';

import type { AppEnv } from '../app-env';
import { HaltSchema, SeatNameSchema } from '../match/match-schema';

/** Largest auth.json accepted (Codex's is about 4 KB). */
const SEAT_BODY_LIMIT = 64 * 1024;

/** The swarm-wide halt switch. */
export const adminRoutes = new Hono<AppEnv>()
  .get('/status', async (c) => {
    const broker = c.env.BROKER.get(c.env.BROKER.idFromName('broker'));
    return c.json({ halted: await broker.halted(), live: await broker.liveMatches() });
  })
  .post('/halt', zValidator('json', HaltSchema), async (c) => {
    const reason = c.req.valid('json').reason;
    const broker = c.env.BROKER.get(c.env.BROKER.idFromName('broker'));
    const live = await broker.halt(reason);
    const halted = await Promise.allSettled(
      live.map((id) => c.env.MATCHES.get(c.env.MATCHES.idFromName(id)).halt(reason)),
    );
    c.var.log.warn('swarm halt', { reason, matches: live.length });
    return c.json({
      halted: live,
      failed: halted.filter((h) => h.status === 'rejected').length,
    });
  })
  .post('/resume', async (c) => {
    await c.env.BROKER.get(c.env.BROKER.idFromName('broker')).resume();
    return c.json({ ok: true });
  });

/**
 * Leased ChatGPT seats. `PUT` takes a Codex `auth.json` body (scripts/seed-seat.sh sends it) and
 * answers with a summary; no route ever returns a token.
 */
export const seatRoutes = new Hono<AppEnv>()
  .get('/', async (c) => {
    const broker = c.env.BROKER.get(c.env.BROKER.idFromName('broker'));
    return c.json({ seats: await broker.listSeats() });
  })
  .put(
    '/:name',
    zValidator('param', z.object({ name: SeatNameSchema })),
    zValidator('query', z.object({ refreshable: z.enum(['0', '1']).default('0') })),
    async (c) => {
      const body = await c.req.text();
      if (body.length > SEAT_BODY_LIMIT) {
        return c.json({ error: { code: 'too_large', message: 'auth.json too large' } }, 413);
      }
      const broker = c.env.BROKER.get(c.env.BROKER.idFromName('broker'));
      try {
        const summary = await broker.putSeat(
          c.req.valid('param').name,
          body,
          c.req.valid('query').refreshable === '1',
        );
        return c.json(summary, 201);
      } catch (error) {
        // Never echo the body or a parse error that quotes it.
        const message =
          error instanceof ZodError || error instanceof SyntaxError
            ? 'not a ChatGPT-mode Codex auth.json'
            : 'could not store the seat';
        return c.json({ error: { code: 'invalid_seat', message } }, 400);
      }
    },
  )
  .delete('/:name', zValidator('param', z.object({ name: SeatNameSchema })), async (c) => {
    const broker = c.env.BROKER.get(c.env.BROKER.idFromName('broker'));
    return c.json({ deleted: await broker.deleteSeat(c.req.valid('param').name) });
  });
