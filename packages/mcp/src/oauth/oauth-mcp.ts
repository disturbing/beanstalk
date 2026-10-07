/**
 * `/mcp` for a person's agent session: an OAuth access token (or a personal `bsu_` token),
 * already validated by the provider, which hands over the grant's props and the token's
 * scopes. A session works on any repository its person may use (tools name it `owner/name`);
 * a tool that names none reads DEMO_RUN, or the newest run the gateway lists. Collaboration
 * writes on race beans stay with contributor tokens.
 */
import type { OAuthResourceAuth } from '@cloudflare/workers-oauth-provider';
import { insufficientScope } from '@cloudflare/workers-oauth-provider';
import { z } from 'zod';

import type { Scope } from '@beanstalk/shared-identity/scopes';
import { parseScopes } from '@beanstalk/shared-identity/scopes';
import { mintSessionToken } from '@beanstalk/shared-identity/user-tokens';
import type { RunId } from '@beanstalk/shared-race/ids';
import { RunId as RunIdSchema } from '@beanstalk/shared-race/ids';
import type { GatewayRpc } from '@beanstalk/shared-race/rpc';

import type { Deps } from '../deps';
import { serveMcp } from '../mcp/serve';
import type { AgentSessionContext } from '../tools/tool-context';
import { GrantProps } from './grant-props';

export function createOAuthMcpHandler(depsFor: (env: Env) => Deps): ExportedHandler<Env> & {
  fetch: NonNullable<ExportedHandler<Env>['fetch']>;
} {
  return {
    async fetch(request, env, ctx) {
      const { gateway, agents, log } = depsFor(env);
      const auth = resourceAuth(ctx);
      const props = GrantProps.safeParse(Reflect.get(ctx, 'props'));
      if (auth === null || !props.success) {
        log.error('oauth request without validated props');
        return Response.json(
          { error: { code: 'internal', message: 'internal error' } },
          { status: 500 },
        );
      }
      const scopes = props.data.via === 'oauth' ? parseScopes(auth.scope) : props.data.scopes;
      if (!scopes.includes('read')) return insufficientScope(auth, ['read']);
      if (gateway === undefined)
        return Response.json(
          { error: { code: 'unavailable', message: 'the GATEWAY binding has no RPC methods' } },
          { status: 503 },
        );
      const run = await sessionRun(env, gateway);
      const session = agentSession(env, {
        props: props.data,
        scopes,
        clientId: auth.clientId ?? null,
      });
      return serveMcp(request, {
        env,
        ctx,
        gateway,
        ...(agents === undefined ? {} : { agents }),
        log,
        caller: { run, sub: props.data.userId, session },
      });
    },
  };
}

function agentSession(
  env: Env,
  input: {
    readonly props: GrantProps;
    readonly scopes: readonly Scope[];
    readonly clientId: string | null;
  },
): AgentSessionContext {
  const { props, scopes, clientId } = input;
  return {
    handle: props.handle,
    clientName: props.clientName,
    via: props.via,
    scopes,
    principal: { user: { id: props.userId, handle: props.handle }, scopes },
    async mintGitToken(repository) {
      const gitScopes = scopes.filter(
        (scope) => scope === 'read' || (scope === 'write' && repository.access === 'write'),
      );
      if (gitScopes.length === 0) return null;
      const { token, summary } = await mintSessionToken(env, {
        userId: props.userId,
        label: `${props.clientName} (MCP git)`,
        scopes: gitScopes,
        ttlSeconds: repository.ttlSeconds,
        repository: repository.engineId,
        ...(clientId === null ? {} : { clientId }),
      });
      return {
        token,
        scopes: summary.scopes,
        expiresAt: new Date(summary.expiresAt).toISOString(),
      };
    },
  };
}

/** DEMO_RUN when set, otherwise the newest run. */
async function sessionRun(env: Env, gateway: GatewayRpc): Promise<RunId | null> {
  const configured = RunIdSchema.safeParse(env.DEMO_RUN);
  if (configured.success) return configured.data;
  const [newest] = await gateway.listRuns(1);
  const parsed = RunIdSchema.safeParse(newest?.run);
  return parsed.success ? parsed.data : null;
}

const ResourceAuth = z.object({
  token: z.string(),
  audience: z.string(),
  scope: z.array(z.string()),
  expiresAt: z.number().optional(),
  userId: z.string().optional(),
  clientId: z.string().optional(),
});

/** What the provider verified about the token (`ctx.auth`), checked rather than assumed. */
function resourceAuth(ctx: ExecutionContext): OAuthResourceAuth | null {
  const parsed = ResourceAuth.safeParse(Reflect.get(ctx, 'auth'));
  if (!parsed.success) return null;
  const { expiresAt, userId, clientId, ...required } = parsed.data;
  return {
    ...required,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(userId === undefined ? {} : { userId }),
    ...(clientId === undefined ? {} : { clientId }),
  };
}
