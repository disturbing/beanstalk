/**
 * What an OAuth grant (or a personal token presented to /mcp) carries into the MCP handler:
 * the person, the client, and the scopes. Validated on the way in; props come from KV.
 */
import { z } from 'zod';

import { Scope } from '@gitstalk/shared-identity/scopes';

export const GrantProps = z.object({
  userId: z.string().min(1),
  handle: z.string().min(1),
  /** The client's display name ("Claude Code"), as the person approved it. */
  clientName: z.string(),
  /** `oauth` for a grant, `token` for a personal access token sent as a bearer. */
  via: z.enum(['oauth', 'token']),
  /** For `token`: the token's scopes. For `oauth` the token's own scopes (ctx.auth) rule. */
  scopes: z.array(Scope),
});
export type GrantProps = z.infer<typeof GrantProps>;

/** Scopes everyone may grant an agent session; landing and settings are never grantable. */
export const GRANTABLE_SCOPES = ['read', 'collaborate', 'write'] as const;

/** Every MCP session needs `read`; clients ask for it first (RFC 9728 `scopes_supported`). */
export const REQUIRED_SCOPES = ['read'];
