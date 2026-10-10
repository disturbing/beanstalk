import { z } from 'zod';

/**
 * Codex's ChatGPT login (`$CODEX_HOME/auth.json`, auth_mode `chatgpt`). The swarm keeps it in
 * the BrokerDO only; a container gets a placeholder, and the model.internal handler adds the
 * access token and account id for the one container holding the seat's lease.
 */
export const AuthJsonSchema = z.object({
  auth_mode: z.literal('chatgpt'),
  tokens: z.object({
    id_token: z.string().min(20),
    access_token: z.string().min(20),
    refresh_token: z.string().min(8),
    account_id: z.string().min(1),
  }),
  last_refresh: z.string().optional(),
});
export type AuthJson = z.infer<typeof AuthJsonSchema>;

export type JwtClaims = { readonly exp: number | null; readonly aud: string | null };

/** The unverified claims Codex itself reads from its tokens (expiry, client id). */
export function jwtClaims(token: string): JwtClaims {
  const payload = token.split('.')[1];
  if (payload === undefined) return { exp: null, aud: null };
  try {
    const json: unknown = JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/')));
    const claims = z
      .object({
        exp: z.number().optional(),
        aud: z.union([z.string(), z.array(z.string())]).optional(),
      })
      .parse(json);
    const aud = Array.isArray(claims.aud) ? (claims.aud[0] ?? null) : (claims.aud ?? null);
    return { exp: claims.exp ?? null, aud };
  } catch {
    return { exp: null, aud: null };
  }
}

/** Refresh this long before the access token expires. */
export const REFRESH_MARGIN_SECONDS = 300;

export function needsRefresh(auth: AuthJson, nowSeconds: number): boolean {
  const { exp } = jwtClaims(auth.tokens.access_token);
  return exp !== null && exp - REFRESH_MARGIN_SECONDS <= nowSeconds;
}

export function isExpired(auth: AuthJson, nowSeconds: number): boolean {
  const { exp } = jwtClaims(auth.tokens.access_token);
  return exp !== null && exp <= nowSeconds;
}

const RefreshReplySchema = z.object({
  id_token: z.string().optional(),
  access_token: z.string().optional(),
  refresh_token: z.string().optional(),
});

export class RefreshError extends Error {
  override readonly name = 'RefreshError';
}

/**
 * Codex's own refresh (the OAuth refresh-token grant, client id = the id token's audience).
 * Refresh tokens rotate on use, so the caller stores the reply before anything else uses the
 * seat, and only a seat whose login belongs to the swarm alone may be refreshed here.
 */
export async function refreshAuth(
  auth: AuthJson,
  tokenUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<AuthJson> {
  const clientId = jwtClaims(auth.tokens.id_token).aud;
  if (clientId === null) throw new RefreshError('the id token names no client id');
  const response = await fetcher(tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: auth.tokens.refresh_token,
      scope: 'openid profile email',
    }),
  });
  if (!response.ok) {
    // The body names the OAuth error code only; it is not echoed in case that ever changes.
    throw new RefreshError(`token refresh answered ${response.status}`);
  }
  const reply = RefreshReplySchema.parse(await response.json());
  return {
    ...auth,
    tokens: {
      ...auth.tokens,
      id_token: reply.id_token ?? auth.tokens.id_token,
      access_token: reply.access_token ?? auth.tokens.access_token,
      refresh_token: reply.refresh_token ?? auth.tokens.refresh_token,
    },
    last_refresh: new Date().toISOString(),
  };
}
