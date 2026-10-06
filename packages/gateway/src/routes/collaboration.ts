/** The collaboration protocol is also usable by contributors without an MCP plugin. */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';

import {
  BeanInboxAckInput,
  BeanDiscoverInput,
  BeanThreadPostInput,
  BeanUpdateInput,
} from '@beanstalk/shared-race/collaboration';
import { TaskId } from '@beanstalk/shared-race/ids';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

import type { AppEnv } from '../app-env';
import { presentedToken } from '../auth/credentials';
import { issueToken } from '../auth/tokens';
import { GatewayError, UnauthorizedError } from '../errors';
import { requireAdmin, requireReader } from '../middleware/auth';
import { collaborationRpc } from '../rpc/collaboration-rpc';
import { unwrap } from './respond';
import { RunParam, validate } from './validation';

const BeanParam = RunParam.extend({ bean: TaskId });
const ContributorGrant = z.strictObject({
  bean: TaskId,
  actor: z.string().trim().min(1).max(32),
  ttl_seconds: z.number().int().min(60).max(86_400).default(3600),
});
const ContextQuery = z.object({
  since: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const InboxQuery = z.object({
  after_cursor: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  state: z.enum(['all', 'unread']).optional(),
});
const MAX_BODY_BYTES = 256 * 1024;

export const collaborationRoutes = new Hono<AppEnv>()
  .use(bodyLimit({ maxSize: MAX_BODY_BYTES }))
  .post(
    '/:run/collaboration/discover',
    requireReader,
    validate('param', RunParam),
    validate('json', BeanDiscoverInput),
    async (c) => {
      return c.json(
        rpcValue(
          await collaborationRpc(c.var.deps).beanDiscover(
            c.req.valid('param').run,
            c.req.valid('json'),
          ),
        ),
      );
    },
  )
  .post(
    '/:run/contributor-token',
    requireAdmin,
    validate('param', RunParam),
    validate('json', ContributorGrant),
    async (c) => {
      const { run } = c.req.valid('param');
      const { bean, actor, ttl_seconds } = c.req.valid('json');
      unwrap(await c.var.deps.run(run).bean(bean));
      const issued = await issueToken(
        c.var.deps.tokenSecret,
        { run, bean, sub: actor, scope: 'contributor' },
        { ttlSeconds: ttl_seconds, nowMs: c.var.deps.now() },
      );
      return c.json({ run, bean, actor, token: issued.token, expires_at: issued.expiresAt }, 201);
    },
  )
  .get(
    '/:run/beans/:bean/context',
    requireReader,
    validate('param', BeanParam),
    validate('query', ContextQuery),
    async (c) => {
      const { run, bean } = c.req.valid('param');
      const result = await collaborationRpc(c.var.deps).beanContext(run, {
        bean,
        ...c.req.valid('query'),
      });
      return c.json(rpcValue(result));
    },
  )
  .post(
    '/:run/beans/:bean/collaboration',
    validate('param', BeanParam),
    validate('json', BeanUpdateInput),
    async (c) => {
      const { bean } = c.req.valid('param');
      const token = await contributorToken(c);
      const input = c.req.valid('json');
      if (input.bean !== bean)
        throw new GatewayError('body bean must match path', 'invalid_request', 400);
      return c.json(rpcValue(await collaborationRpc(c.var.deps).beanUpdate(token, input)));
    },
  )
  .post(
    '/:run/beans/:bean/threads',
    validate('param', BeanParam),
    validate('json', BeanThreadPostInput),
    async (c) => {
      const { bean } = c.req.valid('param');
      const token = await contributorToken(c);
      const input = c.req.valid('json');
      if (input.bean !== bean)
        throw new GatewayError('body bean must match path', 'invalid_request', 400);
      return c.json(rpcValue(await collaborationRpc(c.var.deps).beanThreadPost(token, input)), 201);
    },
  )
  .get(
    '/:run/collaboration/inbox',
    validate('param', RunParam),
    validate('query', InboxQuery),
    async (c) => {
      const token = await contributorToken(c);
      return c.json(
        rpcValue(await collaborationRpc(c.var.deps).beanInboxRead(token, c.req.valid('query'))),
      );
    },
  )
  .post(
    '/:run/collaboration/inbox/ack',
    validate('param', RunParam),
    validate('json', BeanInboxAckInput),
    async (c) => {
      const token = await contributorToken(c);
      return c.json(
        rpcValue(await collaborationRpc(c.var.deps).beanInboxAck(token, c.req.valid('json'))),
      );
    },
  );

/** Enforce the path's run before handing the same token to a reverified RPC mutation. */
async function contributorToken(c: Context<AppEnv>): Promise<string> {
  const token = presentedToken(c.req.raw);
  if (token === null) throw new UnauthorizedError();
  const claims = rpcValue(await collaborationRpc(c.var.deps).verifyMcpToken(token));
  if (claims.scope !== 'contributor' || claims.run !== c.req.param('run')) {
    throw new GatewayError('this contributor token cannot access that run', 'forbidden', 403);
  }
  return token;
}

function rpcValue<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  const { code, message, status } = result.error;
  switch (status) {
    case 400:
    case 401:
    case 403:
    case 404:
    case 409:
    case 410:
    case 413:
    case 422:
    case 500:
    case 502:
    case 503:
    case 504:
      throw new GatewayError(message, code, status);
    default:
      throw new Error(`unexpected RPC status ${status}`);
  }
}
