import { env } from 'cloudflare:workers';

import { ConsentRedirect } from '@beanstalk/shared-identity/agent-sessions';
import { clientIp } from '@beanstalk/shared-identity/request-context';
import { getWebSession } from '@beanstalk/shared-identity/sessions';

import { problem, signedInForm } from '../../../src/auth/http';
import { agentSessionsRpc } from '../../../src/auth/services';
import { log } from '../../../src/log';

/**
 * The consent form's answer: approve with the ticked scopes, or deny. Either way the browser
 * goes back to the agent's redirect URI (a 303 the MCP Worker built from the validated
 * request), or sees an error here if the request expired.
 */
export async function POST(request: Request): Promise<Response> {
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const { session, form } = checked;
  const id = form.get('request');
  if (typeof id !== 'string') return problem(400, 'invalid_request', 'no consent request');
  const user = { id: session.user.id, handle: session.user.handle };
  const rpc = agentSessionsRpc();
  const ip = clientIp(request);
  const decided = ConsentRedirect.safeParse(
    form.get('decision') === 'approve'
      ? await rpc.approveConsent(
          id,
          user,
          form.getAll('scope').filter((scope) => typeof scope === 'string'),
          ip,
        )
      : await rpc.denyConsent(id, user, ip),
  );
  if (!decided.success || decided.data === null) {
    log.info('consent request gone', {
      decision: form.get('decision') === 'approve' ? 'approve' : 'deny',
    });
    return new Response(null, {
      status: 303,
      headers: { location: new URL('/connect?expired=1', request.url).toString() },
    });
  }
  return new Response(null, {
    status: 303,
    headers: { location: decided.data.redirectTo, 'cache-control': 'no-store' },
  });
}
