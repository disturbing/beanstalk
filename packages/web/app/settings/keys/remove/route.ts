import { env } from 'cloudflare:workers';

import { clientIp } from '@gitstalk/shared-identity/request-context';
import { getWebSession } from '@gitstalk/shared-identity/sessions';
import { removeSshKey } from '@gitstalk/shared-identity/ssh-keys';

import { seeOther, signedInForm } from '../../../../src/auth/http';

/** Removes one of the person's SSH keys; it stops opening git over SSH at once. */
export async function POST(request: Request): Promise<Response> {
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const keyId = checked.form.get('key');
  if (typeof keyId === 'string')
    await removeSshKey(env, { userId: checked.session.user.id, keyId, ip: clientIp(request) });
  return seeOther(request, '/settings/keys?note=removed');
}
