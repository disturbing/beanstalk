import { env } from 'cloudflare:workers';

import { ConsentRedirect, ConsentView } from '@gitstalk/shared-identity/agent-sessions';
import { logIdentity, recordProductEvent } from '@gitstalk/shared-identity/product-events';
import { clientIp } from '@gitstalk/shared-identity/request-context';
import { getWebSession } from '@gitstalk/shared-identity/sessions';

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
  const approving = form.get('decision') === 'approve';
  const who = await logIdentity({ userId: user.id, sessionId: session.sessionHash });
  // The client's name for analytics, read before the request is consumed.
  const client = approving ? ConsentView.safeParse(await rpc.consentRequest(id, user)) : null;
  const decided = ConsentRedirect.safeParse(
    approving
      ? await rpc.approveConsent(
          id,
          user,
          form.getAll('scope').filter((scope) => typeof scope === 'string'),
          ip,
        )
      : await rpc.denyConsent(id, user, ip),
  );
  if (!decided.success || decided.data === null) {
    log.info('consent request gone', { decision: approving ? 'approve' : 'deny', ...who });
    return new Response(null, {
      status: 303,
      headers: { location: new URL('/connect?expired=1', request.url).toString() },
    });
  }
  log.info('consent decided', { decision: approving ? 'approve' : 'deny', ...who });
  if (approving)
    await recordProductEvent(env.PRODUCT_EVENTS, 'connect', {
      userId: user.id,
      detail: client?.success === true ? client.data.clientName : '',
    });
  return new Response(null, {
    status: 303,
    headers: { location: decided.data.redirectTo, 'cache-control': 'no-store' },
  });
}
