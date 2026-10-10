/**
 * The MCP endpoint's auth. View access remains read-only; contributor access identifies
 * the owning bean and actor. The gateway verifies signatures and rechecks every write.
 */
import { createMiddleware } from 'hono/factory';
import { z } from 'zod';

import { ContributorTokenClaims } from '@gitstalk/shared-race/collaboration';
import type { RunId } from '@gitstalk/shared-race/ids';
import { RunId as RunIdSchema } from '@gitstalk/shared-race/ids';
import type { GatewayRpc, McpTokenClaims, RpcResult } from '@gitstalk/shared-race/rpc';

import type { AppEnv } from '../app-env';

export type ViewerClaims = {
  readonly run: RunId;
  readonly sub: string;
  readonly expiresAt: string;
  readonly contributor?: ContributorSession;
};

/** Kept only for this request; write RPCs derive identity from the signed token again. */
export type ContributorSession = {
  readonly token: string;
  readonly claims: ContributorTokenClaims;
};

const ViewClaims = z.object({
  scope: z.literal('view'),
  run: RunIdSchema,
  sub: z.string(),
  expires_at: z.iso.datetime(),
});
const McpClaims = z.discriminatedUnion('scope', [ViewClaims, ContributorTokenClaims]);

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
    c.header('WWW-Authenticate', `Bearer realm="gitstalk", error="invalid_token"`);
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
      'send Authorization: Bearer <view or contributor token> (mint one with pnpm -F @gitstalk/mcp mint-token)',
    );
  if (gateway === undefined) return refuse(503, 'the GATEWAY binding has no RPC methods');
  const verified =
    typeof gateway.verifyMcpToken === 'function'
      ? await gateway.verifyMcpToken(token)
      : await legacyViewClaims(gateway, token);
  if (!verified.ok) {
    const status = verified.error.status === 403 ? 403 : 401;
    return refuse(status, verified.error.message);
  }
  const parsed = McpClaims.safeParse(verified.value);
  if (!parsed.success) return refuse(401, 'the token names no valid MCP capability');
  const claims = parsed.data;
  const viewer = { run: claims.run, expiresAt: claims.expires_at };
  if (claims.scope === 'view') return { ok: true, viewer: { ...viewer, sub: claims.sub } };
  return {
    ok: true,
    viewer: { ...viewer, sub: claims.actor, contributor: { token, claims } },
  };
}

async function legacyViewClaims(
  gateway: GatewayRpc,
  token: string,
): Promise<RpcResult<McpTokenClaims>> {
  const verified = await gateway.verifyViewToken(token);
  if (!verified.ok) return verified;
  return { ok: true, value: { ...verified.value, scope: 'view' } };
}

function bearerToken(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  const token = match?.[1];
  return token === undefined || token.length > MAX_TOKEN_LENGTH ? undefined : token;
}

function refuse(status: AuthFailure['status'], message: string): AuthResult {
  return { ok: false, failure: { status, message } };
}
