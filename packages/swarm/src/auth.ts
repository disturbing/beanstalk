import type { MiddlewareHandler } from 'hono';

import type { AppEnv } from './app-env';

/** `Authorization: Bearer <SWARM_ADMIN_TOKEN>` on every /v1 route, compared in constant time. */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('authorization') ?? '';
  const [scheme, token] = header.split(/\s+/, 2);
  const ok =
    scheme?.toLowerCase() === 'bearer' &&
    token !== undefined &&
    (await isSameSecret(token, c.env.SWARM_ADMIN_TOKEN));
  if (!ok) return c.json({ error: { code: 'unauthorized', message: 'admin token required' } }, 401);
  await next();
  return undefined;
};

export async function isSameSecret(presented: string, expected: string): Promise<boolean> {
  if (expected === '') return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(presented)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(left, right);
}
