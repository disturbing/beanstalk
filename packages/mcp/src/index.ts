/**
 * gitstalk-mcp: MCP tools for coding agents (`docs/claude-opus/06-auth-mcp-live-previews.md`
 * §4), behind two kinds of credential:
 * - run tokens (`Authorization: Bearer bst1.…`, view or contributor) go to the run-token app,
 *   unchanged since before accounts;
 * - everything else meets the OAuth 2.1 provider (./oauth/provider.ts): people's agent
 *   sessions, personal tokens, discovery, registration, tokens and `/authorize`.
 * RPC methods serve the web app's consent screen and connected-sessions settings.
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { OAuthProvider, getOAuthApi } from '@cloudflare/workers-oauth-provider';

import type {
  AgentSession,
  AgentSessionsRpc,
  ConsentRedirect,
  ConsentUser,
  ConsentView,
} from '@gitstalk/shared-identity/agent-sessions';
import { withHsts } from '@gitstalk/shared-identity/transport-security';

import { createApp } from './app';
import { depsFromEnv } from './deps';
import { createAuthorizeHandler } from './oauth/authorize';
import {
  approvePendingConsent,
  denyPendingConsent,
  describePendingConsent,
  listAgentSessions,
  revokeAgentSession,
} from './oauth/consent-service';
import { createOAuthMcpHandler } from './oauth/oauth-mcp';
import type { ProviderHandlers } from './oauth/provider';
import { providerOptions } from './oauth/provider';

const runTokenApp = createApp(depsFromEnv);
const handlers: ProviderHandlers = {
  api: createOAuthMcpHandler(depsFromEnv),
  authorize: createAuthorizeHandler((env) => oauthApi(env)),
};

/** Run tokens go to the run-token app; everything else meets the OAuth provider. */
function answer(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (hasRunToken(request)) return Promise.resolve(runTokenApp.fetch(request, env, ctx));
  return new OAuthProvider(providerOptions(env, handlers)).fetch(request, env, ctx);
}

export default class GitstalkMcp extends WorkerEntrypoint<Env> implements AgentSessionsRpc {
  override async fetch(request: Request): Promise<Response> {
    return withHsts(request, await answer(request, this.env, this.ctx));
  }

  /** The consent page's facts for a pending request (claims it for this person). */
  consentRequest(id: string, user: ConsentUser): Promise<ConsentView | null> {
    return describePendingConsent(this.env, { id, user });
  }

  /** Approves a pending request; the client's redirect, or null when it expired or is not theirs. */
  approveConsent(
    id: string,
    user: ConsentUser,
    scopes: readonly string[],
    ip: string | null,
  ): Promise<ConsentRedirect> {
    return approvePendingConsent(this.env, oauthApi(this.env), { id, user, scopes, ip });
  }

  denyConsent(id: string, user: ConsentUser, ip: string | null): Promise<ConsentRedirect> {
    return denyPendingConsent(this.env, { id, user, ip });
  }

  /** A person's connected agent sessions (OAuth grants). */
  agentSessions(userId: string): Promise<readonly AgentSession[]> {
    return listAgentSessions(oauthApi(this.env), userId);
  }

  revokeAgentSession(userId: string, grantId: string, ip: string | null): Promise<boolean> {
    return revokeAgentSession(this.env, oauthApi(this.env), { userId, grantId, ip });
  }
}

function oauthApi(env: Env): OAuthHelpers {
  return getOAuthApi(providerOptions(env, handlers), env);
}

/** Run tokens are `bst1.<claims>.<signature>`; they keep their own path. */
function hasRunToken(request: Request): boolean {
  return /^Bearer\s+bst1\./i.test(request.headers.get('authorization') ?? '');
}
