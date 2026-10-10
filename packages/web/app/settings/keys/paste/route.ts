import { env } from 'cloudflare:workers';

import { clientIp } from '@gitstalk/shared-identity/request-context';
import { getWebSession } from '@gitstalk/shared-identity/sessions';
import { addSshKey } from '@gitstalk/shared-identity/ssh-keys';

import { seeOther, signedInForm } from '../../../../src/auth/http';

/** Adds a public key pasted into Settings → SSH keys. */
export async function POST(request: Request): Promise<Response> {
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const publicKey = checked.form.get('public_key');
  const name = checked.form.get('name');
  const added = await addSshKey(env, {
    userId: checked.session.user.id,
    publicKey: typeof publicKey === 'string' ? publicKey : '',
    name: typeof name === 'string' ? name : '',
    ip: clientIp(request),
  });
  return seeOther(
    request,
    added.ok
      ? '/settings/keys?note=added'
      : `/settings/keys?error=${encodeURIComponent(added.reason)}`,
  );
}
