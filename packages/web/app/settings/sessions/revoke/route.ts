import { env } from 'cloudflare:workers';

import { clientIp } from '@gitstalk/shared-identity/request-context';
import { getWebSession } from '@gitstalk/shared-identity/sessions';

import { seeOther, signedInForm } from '../../../../src/auth/http';
import { agentSessionsRpc } from '../../../../src/auth/services';

/** Disconnects an agent session: revokes its OAuth grant and its git session tokens. */
export async function POST(request: Request): Promise<Response> {
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const grantId = checked.form.get('grant');
  if (typeof grantId === 'string')
    await agentSessionsRpc().revokeAgentSession(
      checked.session.user.id,
      grantId,
      clientIp(request),
    );
  return seeOther(request, '/settings/sessions?disconnected=1');
}
