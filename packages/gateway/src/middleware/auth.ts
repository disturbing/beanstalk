/**
 * Route guards. Admin routes take `Authorization: Bearer <ADMIN_TOKEN>`. Driver routes take
 * a slot token for the run and slot in the path. Read-only run routes also take a view
 * token, as a bearer or as `?key=` (a browser cannot set headers on a WebSocket).
 */
import { createMiddleware } from 'hono/factory';

import { RunId } from '@gitstalk/shared-race/ids';

import type { AppEnv, Principal } from '../app-env';
import { isSameSecret, presentedToken, queryToken } from '../auth/credentials';
import type { TokenClaims, TokenScope } from '../auth/tokens';
import { verifyToken } from '../auth/tokens';
import { ForbiddenError, UnauthorizedError } from '../errors';

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const token = presentedToken(c.req.raw);
  if (token === null || !(await isSameSecret(token, c.var.deps.adminToken)))
    throw new UnauthorizedError();
  c.set('principal', { kind: 'admin' });
  await next();
});

/** A slot token for the `:run` (and, when present, the `:slot`) of the path. */
export const requireSlotToken = createMiddleware<AppEnv>(async (c, next) => {
  const claims = await runTokenClaims(c.req.raw, c.var.deps, c.req.param('run'), ['slot']);
  const slot = c.req.param('slot');
  if (slot !== undefined && claims.sub !== slot)
    throw new ForbiddenError(`this token belongs to slot ${claims.sub}`);
  c.set('principal', { kind: 'token', claims });
  await next();
});

/** The admin, or a view (or slot) token of the `:run` in the path. */
export const requireReader = createMiddleware<AppEnv>(async (c, next) => {
  const bearer = presentedToken(c.req.raw);
  if (bearer !== null && (await isSameSecret(bearer, c.var.deps.adminToken))) {
    c.set('principal', { kind: 'admin' });
    await next();
    return;
  }
  const claims = await runTokenClaims(c.req.raw, c.var.deps, c.req.param('run'), [
    'view',
    'slot',
    'contributor',
  ]);
  c.set('principal', { kind: 'token', claims });
  await next();
});

async function runTokenClaims(
  request: Request,
  deps: { tokenSecret: string; now: () => number },
  runParam: string | undefined,
  scopes: readonly TokenScope[],
): Promise<TokenClaims> {
  const token = presentedToken(request) ?? queryToken(request);
  if (token === null) throw new UnauthorizedError();
  const check = await verifyToken(deps.tokenSecret, token, deps.now());
  if (!check.ok) throw new UnauthorizedError(`run token ${check.failure.replace('_', ' ')}`);
  const run = RunId.safeParse(runParam);
  if (!run.success || check.claims.run !== run.data)
    throw new ForbiddenError('this token belongs to another run');
  if (!scopes.includes(check.claims.scope))
    throw new ForbiddenError(`a ${check.claims.scope} token cannot do this`);
  return check.claims;
}

/** The claims of a token principal (routes behind `requireSlotToken` always have them). */
export function tokenClaims(principal: Principal): TokenClaims {
  if (principal.kind !== 'token') throw new ForbiddenError('a run token is required');
  return principal.claims;
}
