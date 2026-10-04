/**
 * The MCP endpoint's auth: `Authorization: Bearer <view token>`, a run-scoped token the
 * gateway minted (`viewToken` RPC or `POST /v1/runs/:run/view-token`). The gateway checks it
 * (`verifyViewToken`); this Worker holds no token secret. Every tool reads only that run.
 */
import { createMiddleware } from 'hono/factory';

import type { RunId } from '@beanstalk/shared-race/ids';
import { RunId as RunIdSchema } from '@beanstalk/shared-race/ids';
import type { GatewayRpc } from '@beanstalk/shared-race/rpc';

import type { AppEnv } from '../app-env';

export type ViewerClaims = {
  readonly run: RunId;
  readonly sub: string;
  readonly expiresAt: string;
};

export type AuthFailure = { readonly status: 401 | 403 | 503; readonly message: string };

export type AuthResult =
  | { readonly ok: true; readonly viewer: ViewerClaims }
  | { readonly ok: false; readonly failure: AuthFailure };

/** Tokens are short base64url segments; anything far longer is not one. */
const MAX_TOKEN_LENGTH = 2048;

/** Sets `viewer` for a valid view token; answers 401 (or 403, 503) otherwise. */
export const requireViewer = createMiddleware<AppEnv>(async (c, next) => {
  const result = await authenticate(c.var.deps.gateway, c.req.header('authorization'));
  if (!result.ok) {
    const { status, message } = result.failure;
    c.var.deps.log.info('mcp request refused', { status });
    c.header('WWW-Authenticate', `Bearer realm="beanstalk", error="invalid_token"`);
    return c.json(
      { error: { code: status === 401 ? 'unauthorized' : 'forbidden', message } },
      status,
    );
  }
  c.set('viewer', result.viewer);
  await next();
  return undefined;
});

/** Checks a request's bearer token through the gateway. */
export async function authenticate(
  gateway: GatewayRpc | undefined,
  header: string | undefined,
): Promise<AuthResult> {
  const token = bearerToken(header);
  if (token === undefined)
    return refuse(
      401,
      'send Authorization: Bearer <view token> (mint one with pnpm -F @beanstalk/mcp mint-token)',
    );
  if (gateway === undefined) return refuse(503, 'the GATEWAY binding has no RPC methods');
  const verified = await gateway.verifyViewToken(token);
  if (!verified.ok) {
    const status = verified.error.status === 403 ? 403 : 401;
    return refuse(status, verified.error.message);
  }
  const run = RunIdSchema.safeParse(verified.value.run);
  if (!run.success) return refuse(401, 'the token names no valid run');
  const { sub, expires_at: expiresAt } = verified.value;
  return { ok: true, viewer: { run: run.data, sub, expiresAt } };
}

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  const token = match?.[1];
  return token === undefined || token.length > MAX_TOKEN_LENGTH ? undefined : token;
}

function refuse(status: AuthFailure['status'], message: string): AuthResult {
  return { ok: false, failure: { status, message } };
}
