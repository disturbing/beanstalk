/**
 * The MCP Worker's RPC contract for the web app: the consent screen (`/connect`) and the
 * connected-agents list in Settings. The MCP Worker implements it (packages/mcp/src/index.ts);
 * the web app narrows its MCP service binding to it (wrangler types it as a plain Fetcher)
 * and validates every answer.
 */
import { z } from 'zod';

import type { IdentityEnv } from './identity-env';
import { Scope, parseScopes } from './scopes';

/** The person deciding, as the web app's session knows them. */
export type ConsentUser = { readonly id: string; readonly handle: string };

/** What the consent page shows. Every string except the scopes came from the client. */
export const ConsentView = z.object({
  clientId: z.string(),
  clientName: z.string(),
  /** Set for a Client ID Metadata Document client: a domain the client controls. */
  clientDomain: z.string().nullable(),
  redirectHost: z.string(),
  redirectIsLoopback: z.boolean(),
  requestedScopes: z.array(Scope),
  grantableScopes: z.array(Scope),
});
export type ConsentView = z.infer<typeof ConsentView>;

export const AgentSession = z.object({
  grantId: z.string(),
  clientId: z.string(),
  clientName: z.string(),
  scopes: z.array(Scope),
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
  /**
   * Approved moments ago and not yet in the grant list (KV lists are eventually consistent,
   * up to a minute): shown from the audit log, without a grant id to revoke by yet.
   */
  settling: z.boolean().optional(),
});
export type AgentSession = z.infer<typeof AgentSession>;

export const ConsentRedirect = z.object({ redirectTo: z.url() }).nullable();
export type ConsentRedirect = z.infer<typeof ConsentRedirect>;

export type AgentSessionsRpc = {
  consentRequest(id: string, user: ConsentUser): Promise<ConsentView | null>;
  approveConsent(
    id: string,
    user: ConsentUser,
    scopes: readonly string[],
    ip: string | null,
  ): Promise<ConsentRedirect>;
  denyConsent(id: string, user: ConsentUser, ip: string | null): Promise<ConsentRedirect>;
  agentSessions(userId: string): Promise<readonly AgentSession[]>;
  revokeAgentSession(userId: string, grantId: string, ip: string | null): Promise<boolean>;
};

const METHODS = [
  'consentRequest',
  'approveConsent',
  'denyConsent',
  'agentSessions',
  'revokeAgentSession',
] as const;

/** Whether a binding answers the contract (an RPC stub exposes every remote method). */
export function isAgentSessionsRpc(binding: unknown): binding is AgentSessionsRpc {
  if ((typeof binding !== 'object' && typeof binding !== 'function') || binding === null)
    return false;
  return METHODS.every((method) => typeof Reflect.get(binding, method) === 'function');
}

/** How long an approval is shown from the audit log before the grant list must have it. */
export const SETTLING_MS = 120_000;
/** A listed grant this close to an approval is that approval's grant. */
const SAME_GRANT_MS = 30_000;

const GrantDetail = z.object({
  client: z.string().optional(),
  scopes: z.array(z.string()).optional(),
});
const AuditRow = z.object({
  at: z.number(),
  action: z.string(),
  target: z.string().nullable(),
  detail: z.string(),
});

/**
 * A person's agent sessions with the ones approved in the last two minutes added from the
 * audit log (D1, read-your-writes) when the grant list does not have them yet. That is what
 * lets Home show a session within seconds of its sign-in.
 */
export async function withSettlingSessions(
  env: IdentityEnv,
  input: {
    readonly userId: string;
    readonly listed: readonly AgentSession[];
    readonly now: number;
  },
): Promise<readonly AgentSession[]> {
  const recent = await recentApprovals(env, input.userId, input.now);
  const settling = recent.filter(
    (approval) =>
      !input.listed.some(
        (session) =>
          session.clientId === approval.clientId &&
          Math.abs(session.createdAt - approval.createdAt) < SAME_GRANT_MS,
      ),
  );
  return [...settling, ...input.listed].toSorted((a, b) => b.createdAt - a.createdAt);
}

/** Approvals in the settling window that no later revocation of the same client undid. */
async function recentApprovals(
  env: IdentityEnv,
  userId: string,
  now: number,
): Promise<readonly AgentSession[]> {
  const { results } = await env.IDENTITY_DB.prepare(
    "SELECT at, action, target, detail FROM audit_events WHERE actor_user_id = ? AND at >= ? AND action IN ('oauth.grant', 'oauth.revoke') ORDER BY at",
  )
    .bind(userId, now - SETTLING_MS)
    .all();
  const rows = AuditRow.array().parse(results);
  return rows.flatMap((row) => {
    if (row.action !== 'oauth.grant' || row.target === null) return [];
    const revokedLater = rows.some(
      (later) =>
        later.action === 'oauth.revoke' && later.target === row.target && later.at >= row.at,
    );
    return revokedLater ? [] : [settlingSession(row.target, row.at, row.detail)];
  });
}

function settlingSession(clientId: string, at: number, detail: string): AgentSession {
  const parsed = GrantDetail.safeParse(parseJson(detail));
  const facts = parsed.success ? parsed.data : {};
  return {
    grantId: `settling:${clientId}:${at}`,
    clientId,
    clientName: facts.client ?? clientId,
    scopes: [...parseScopes(facts.scopes ?? ['read'])],
    createdAt: at,
    expiresAt: null,
    settling: true,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON: the detail is treated as empty.
    return null;
  }
}
