import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../app-env';
import { swarmConfig } from '../config';
import { HaltSchema, MatchCreateSchema } from '../match/match-schema';

const MatchIdSchema = z.object({ id: z.string().regex(/^m-[a-z0-9-]{6,40}$/) });

/** Matches: create (starts the containers), view, release, halt, and the slots' logs and files. */
export const matchRoutes = new Hono<AppEnv>()
  .post('/', zValidator('json', MatchCreateSchema), async (c) => {
    const body = c.req.valid('json');
    const config = swarmConfig(c.env);
    if (body.slots.length > config.maxAgents) {
      return c.json(
        { error: { code: 'too_many_agents', message: `at most ${config.maxAgents} agents` } },
        400,
      );
    }
    if (body.credential.mode === 'api-key' && config.openaiApiKey === null) {
      return c.json(
        { error: { code: 'no_api_key', message: 'set the OPENAI_API_KEY secret first' } },
        409,
      );
    }
    const broker = c.env.BROKER.get(c.env.BROKER.idFromName('broker'));
    const halted = await broker.halted();
    if (halted !== null) {
      return c.json({ error: { code: 'halted', message: `swarm halted: ${halted.reason}` } }, 409);
    }
    const id = `m-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    const view = await matchStub(c.env, id).create(id, body);
    c.var.log.info('match created', { match: id, agents: body.slots.length });
    return c.json(view, 201);
  })
  .get('/', async (c) => {
    const broker = c.env.BROKER.get(c.env.BROKER.idFromName('broker'));
    return c.json({ live: await broker.liveMatches() });
  })
  .get('/:id', zValidator('param', MatchIdSchema), async (c) => {
    const stub = matchStub(c.env, c.req.valid('param').id);
    if (!(await stub.exists())) return notFound(c);
    return c.json(await stub.view());
  })
  .post('/:id/release', zValidator('param', MatchIdSchema), async (c) => {
    const stub = matchStub(c.env, c.req.valid('param').id);
    if (!(await stub.exists())) return notFound(c);
    const outcome = await stub.release();
    if (!outcome.released) {
      return c.json({ error: { code: 'invalid_state', message: outcome.reason } }, 409);
    }
    return c.json(outcome.view);
  })
  .post(
    '/:id/halt',
    zValidator('param', MatchIdSchema),
    zValidator('json', HaltSchema),
    async (c) => {
      const stub = matchStub(c.env, c.req.valid('param').id);
      if (!(await stub.exists())) return notFound(c);
      return c.json(await stub.halt(c.req.valid('json').reason));
    },
  )
  .get('/:id/log', zValidator('param', MatchIdSchema), async (c) => {
    const stub = matchStub(c.env, c.req.valid('param').id);
    if (!(await stub.exists())) return notFound(c);
    return c.body(await stub.log(), 200, { 'content-type': 'application/x-ndjson' });
  })
  .get('/:id/files', zValidator('param', MatchIdSchema), async (c) => {
    const stub = matchStub(c.env, c.req.valid('param').id);
    if (!(await stub.exists())) return notFound(c);
    return c.json({ files: await stub.files() });
  })
  .get(
    '/:id/file',
    zValidator('param', MatchIdSchema),
    zValidator('query', z.object({ slot: z.string().max(10), name: z.string().max(120) })),
    async (c) => {
      const { slot, name } = c.req.valid('query');
      const content = await matchStub(c.env, c.req.valid('param').id).file(slot, name);
      if (content === null) return notFound(c);
      return c.body(content, 200, { 'content-type': 'application/octet-stream' });
    },
  );

function matchStub(env: Env, id: string) {
  return env.MATCHES.get(env.MATCHES.idFromName(id));
}

function notFound(c: { json: (body: unknown, status: 404) => Response }): Response {
  return c.json({ error: { code: 'not_found', message: 'no such match' } }, 404);
}
