/**
 * `/authorize`: the library validates the client, redirect URI, PKCE and resource; the
 * person then signs in and approves on the web app (`/connect`), which completes the grant
 * through this Worker's RPC (./consent-service.ts). Everything else not under /mcp or the
 * protocol endpoints lands here too.
 */
import type { OAuthHelpers } from '@cloudflare/workers-oauth-provider';
import { AuthorizationError, CimdFetchError } from '@cloudflare/workers-oauth-provider';

import { createLogger, isLogLevel } from '../log';
import { saveConsent } from './consent-store';
import { AUTHORIZE_PATH } from './provider';

export function createAuthorizeHandler(api: (env: Env) => OAuthHelpers): ExportedHandler<Env> {
  return {
    async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/' && request.method === 'GET') return info(env);
      if (url.pathname !== AUTHORIZE_PATH)
        return Response.json(
          { error: { code: 'not_found', message: 'no such route' } },
          { status: 404 },
        );
      if (request.method !== 'GET') return new Response('method not allowed', { status: 405 });
      return authorize(request, env, api(env));
    },
  };
}

async function authorize(request: Request, env: Env, oauth: OAuthHelpers): Promise<Response> {
  try {
    const parsed = await oauth.parseAuthRequest(request);
    const description = await oauth.describeConsent(parsed);
    const id = await saveConsent(env.OAUTH_KV, { request: parsed, description, now: Date.now() });
    const connect = new URL('/connect', env.WEB_URL);
    connect.searchParams.set('request', id);
    return new Response(null, {
      status: 302,
      headers: { location: connect.toString(), 'cache-control': 'no-store' },
    });
  } catch (error: unknown) {
    if (error instanceof AuthorizationError && error.redirectTo !== undefined)
      return new Response(null, { status: 302, headers: { location: error.redirectTo } });
    if (error instanceof AuthorizationError || error instanceof CimdFetchError) {
      logger(env).info('authorization request refused', {
        reason: error instanceof AuthorizationError ? error.code : 'client_metadata',
      });
      const message =
        error instanceof AuthorizationError ? error.description : 'This app could not be verified.';
      return new Response(`Gitstalk could not start this sign-in: ${message}`, {
        status: 400,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    throw error;
  }
}

function info(env: Env): Response {
  return Response.json({
    name: 'beanstalk-mcp',
    mcp: '/mcp',
    auth: 'OAuth 2.1 (see /.well-known/oauth-protected-resource/mcp); run tokens: Authorization: Bearer bst1.…',
    web: env.WEB_URL,
  });
}

function logger(env: Env) {
  return createLogger(isLogLevel(env.LOG_LEVEL) ? env.LOG_LEVEL : 'info', {
    worker: 'beanstalk-mcp',
  });
}
