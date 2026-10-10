import { env } from 'cloudflare:workers';

/**
 * `GET /v1/whoami` on the web host: git is served here (`/<owner>/<repo>.git`), so the check
 * `/gitstalk:setup verify` makes against the git origin is too. Forwarded to the gateway with
 * the credential header as sent (`v1` is a reserved handle, so no owner page is shadowed).
 */
export async function GET(request: Request): Promise<Response> {
  const headers = new Headers();
  const authorization = request.headers.get('authorization');
  if (authorization !== null) headers.set('authorization', authorization);
  const agent = request.headers.get('user-agent');
  if (agent !== null) headers.set('user-agent', agent);
  return env.GATEWAY.fetch(new Request('https://gateway.internal/v1/whoami', { headers }));
}
