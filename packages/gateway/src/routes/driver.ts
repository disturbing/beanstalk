/**
 * Driver routes: one slot's long poll, and its invocation results and progress. Every
 * request carries that slot's run token.
 */
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import type { NextResponse, TokenRefresh } from '@gitstalk/shared-race/driver';
import { InvocationProgress, InvocationResult, StreamDelta } from '@gitstalk/shared-race/driver';
import { InvocationId, RunId, SlotId } from '@gitstalk/shared-race/ids';

import type { AppEnv } from '../app-env';
import type { TokenClaims } from '../auth/tokens';
import { issueToken } from '../auth/tokens';
import type { Deps } from '../deps';
import { requireSlotToken, tokenClaims } from '../middleware/auth';
import { unwrap } from './respond';
import { validate } from './validation';

/** Invocation results carry an agent's final message and usage, never megabytes. */
const MAX_RESULT_BYTES = 2 * 1024 * 1024;
/** A streamed delta: at most 64 KB of patch text, plus paths and JSON escaping. */
const MAX_STREAM_BYTES = 256 * 1024;

const SlotParams = z.object({ run: RunId, slot: SlotId });
const InvocationParams = z.object({ run: RunId, inv: InvocationId });

export const driverRoutes = new Hono<AppEnv>()
  .post('/:run/agents/:slot/next', requireSlotToken, validate('param', SlotParams), async (c) => {
    const { run, slot } = c.req.valid('param');
    const deps = c.var.deps;
    const gitBase = `${new URL(c.req.url).origin}/git/${deps.config.namespace}`;
    const reply = unwrap(await deps.run(run).next(slot, gitBase));
    return c.json(await withRefreshedToken(reply, deps, tokenClaims(c.var.principal)));
  })
  .post(
    '/:run/invocations/:inv/result',
    requireSlotToken,
    bodyLimit({ maxSize: MAX_RESULT_BYTES }),
    validate('param', InvocationParams),
    validate('json', InvocationResult),
    async (c) => {
      const { run, inv } = c.req.valid('param');
      const slot = SlotId.parse(tokenClaims(c.var.principal).sub);
      return c.json(unwrap(await c.var.deps.run(run).result(slot, inv, c.req.valid('json'))));
    },
  )
  .post(
    '/:run/invocations/:inv/progress',
    requireSlotToken,
    validate('param', InvocationParams),
    validate('json', InvocationProgress),
    async (c) => {
      const { run, inv } = c.req.valid('param');
      const slot = SlotId.parse(tokenClaims(c.var.principal).sub);
      return c.json(unwrap(await c.var.deps.run(run).progress(slot, inv, c.req.valid('json'))));
    },
  )
  .post(
    '/:run/invocations/:inv/stream',
    requireSlotToken,
    bodyLimit({ maxSize: MAX_STREAM_BYTES }),
    validate('param', InvocationParams),
    validate('json', StreamDelta),
    async (c) => {
      // The run's stream object checks the slot owns the open invocation: the engine's
      // RunDO never sees a post (docs/claude-17-streaming-diffs.md).
      const { run, inv } = c.req.valid('param');
      const slot = SlotId.parse(tokenClaims(c.var.principal).sub);
      return c.json(unwrap(await c.var.deps.streams(run).post(slot, inv, c.req.valid('json'))));
    },
  );

/** Adds a fresh slot token once the one in use has less than half its lifetime left. */
async function withRefreshedToken(
  reply: NextResponse,
  deps: Deps,
  claims: TokenClaims,
): Promise<NextResponse> {
  if ('done' in reply) return reply;
  const remainingSeconds = claims.exp - deps.now() / 1000;
  if (remainingSeconds > deps.config.runTokenTtlSeconds / 2) return reply;
  const issued = await issueToken(
    deps.tokenSecret,
    { run: claims.run, sub: claims.sub, scope: 'slot' },
    { ttlSeconds: deps.config.runTokenTtlSeconds, nowMs: deps.now() },
  );
  const token: TokenRefresh = { token: issued.token, expires_at: issued.expiresAt };
  return { ...reply, token };
}
