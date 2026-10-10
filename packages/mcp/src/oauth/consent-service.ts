/**
 * The web app's side of consent and connected sessions, called over the MCP Worker's RPC
 * (the service binding is the trust boundary: the web app has already checked the person's
 * session and CSRF token). Grants and revocations are audited in D1.
 */
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { authorizationErrorRedirect } from '@cloudflare/workers-oauth-provider';

import type {
  AgentSession,
  ConsentUser,
  ConsentView,
} from '@gitstalk/shared-identity/agent-sessions';
import { recordAudit } from '@gitstalk/shared-identity/audit';
import type { Scope } from '@gitstalk/shared-identity/scopes';
import { parseScopes } from '@gitstalk/shared-identity/scopes';
import { revokeClientTokens } from '@gitstalk/shared-identity/user-tokens';

import { claimConsent, takeConsent } from './consent-store';
import type { GrantProps } from './grant-props';
import { GRANTABLE_SCOPES } from './grant-props';

export async function describePendingConsent(
  env: Env,
  input: { readonly id: string; readonly user: ConsentUser },
): Promise<ConsentView | null> {
  const stored = await claimConsent(env.OAUTH_KV, input.id, input.user.id);
  if (stored === null) return null;
  const { description } = stored;
  return {
    clientId: description.clientId,
    clientName: description.clientName,
    clientDomain: description.clientDomain ?? null,
    redirectHost: description.redirectHost,
    redirectIsLoopback: description.redirectIsLoopback,
    requestedScopes: [...withRead(parseScopes(description.scope))],
    grantableScopes: [...GRANTABLE_SCOPES],
  };
}

/** Approves with the scopes the person ticked (always including read); the client's redirect. */
export async function approvePendingConsent(
  env: Env,
  oauth: OAuthHelpers,
  input: {
    readonly id: string;
    readonly user: ConsentUser;
    readonly scopes: readonly string[];
    readonly ip: string | null;
  },
): Promise<{ readonly redirectTo: string } | null> {
  const stored = await takeConsent(env.OAUTH_KV, input.id, input.user.id);
  if (stored === null) return null;
  const scopes = withRead(parseScopes(input.scopes));
  const clientName = stored.description.clientName.slice(0, 80);
  const props: GrantProps = {
    userId: input.user.id,
    handle: input.user.handle,
    clientName,
    via: 'oauth',
    scopes: [...scopes],
  };
  const { redirectTo } = await oauth.completeAuthorization({
    request: stored.request,
    userId: input.user.id,
    metadata: { clientName, approvedAt: Date.now() },
    scope: [...scopes],
    props,
  });
  await recordAudit(
    env,
    {
      action: 'oauth.grant',
      actorUserId: input.user.id,
      target: stored.request.clientId,
      ip: input.ip,
      detail: {
        client: clientName,
        scopes: [...scopes],
        redirect_host: stored.description.redirectHost,
      },
    },
    Date.now(),
  );
  return { redirectTo };
}

/** Declines: the client hears `access_denied`. */
export async function denyPendingConsent(
  env: Env,
  input: { readonly id: string; readonly user: ConsentUser; readonly ip: string | null },
): Promise<{ readonly redirectTo: string } | null> {
  const stored = await takeConsent(env.OAUTH_KV, input.id, input.user.id);
  if (stored === null) return null;
  await recordAudit(
    env,
    {
      action: 'oauth.deny',
      actorUserId: input.user.id,
      target: stored.request.clientId,
      ip: input.ip,
    },
    Date.now(),
  );
  const redirectTo = authorizationErrorRedirect(
    stored.request,
    'access_denied',
    'The person declined.',
  );
  return { redirectTo };
}

/** The agent sessions (OAuth grants) a person has approved. */
export async function listAgentSessions(
  oauth: OAuthHelpers,
  userId: string,
): Promise<readonly AgentSession[]> {
  const sessions: AgentSession[] = [];
  let cursor: string | undefined;
  do {
    // oxlint-disable-next-line no-await-in-loop -- pages follow one another's cursor
    const page = await oauth.listUserGrants(
      userId,
      cursor === undefined ? { limit: 100 } : { limit: 100, cursor },
    );
    for (const grant of page.items) sessions.push(toSession(grant));
    cursor = page.cursor;
  } while (cursor !== undefined && sessions.length < 500);
  return sessions.toSorted((a, b) => b.createdAt - a.createdAt);
}

/** Revokes one of a person's grants and every session token minted for that client. */
export async function revokeAgentSession(
  env: Env,
  oauth: OAuthHelpers,
  input: { readonly userId: string; readonly grantId: string; readonly ip: string | null },
): Promise<boolean> {
  const sessions = await listAgentSessions(oauth, input.userId);
  const session = sessions.find((candidate) => candidate.grantId === input.grantId);
  if (session === undefined) return false;
  await oauth.revokeGrant(session.grantId, input.userId);
  const now = Date.now();
  await revokeClientTokens(env, { userId: input.userId, clientId: session.clientId }, now);
  await recordAudit(
    env,
    {
      action: 'oauth.revoke',
      actorUserId: input.userId,
      target: session.clientId,
      ip: input.ip,
      detail: { client: session.clientName },
    },
    now,
  );
  return true;
}

function withRead(scopes: readonly Scope[]): readonly Scope[] {
  return scopes.includes('read') ? scopes : ['read', ...scopes];
}

function toSession(grant: {
  readonly id: string;
  readonly clientId: string;
  readonly scope: readonly string[];
  readonly metadata: unknown;
  readonly createdAt: number;
  readonly expiresAt?: number;
}): AgentSession {
  const name: unknown =
    typeof grant.metadata === 'object' && grant.metadata !== null
      ? Reflect.get(grant.metadata, 'clientName')
      : undefined;
  return {
    grantId: grant.id,
    clientId: grant.clientId,
    clientName: typeof name === 'string' ? name : grant.clientId,
    scopes: [...parseScopes(grant.scope)],
    createdAt: toMillis(grant.createdAt),
    expiresAt: grant.expiresAt === undefined ? null : toMillis(grant.expiresAt),
  };
}

/** The library stores unix seconds; the web app shows milliseconds like every other time. */
function toMillis(time: number): number {
  return time < 1e12 ? time * 1000 : time;
}
