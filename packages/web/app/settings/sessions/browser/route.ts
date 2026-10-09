import { env } from 'cloudflare:workers';

import { getWebSession, revokeBrowserSession } from '@beanstalk/shared-identity/sessions';

import { seeOther, signedInForm } from '../../../../src/auth/http';

/** Signs one of the person's other browsers out. */
export async function POST(request: Request): Promise<Response> {
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const browser = checked.form.get('browser');
  const ended =
    typeof browser === 'string' &&
    (await revokeBrowserSession(env, {
      userId: checked.session.user.id,
      id: browser,
      now: Date.now(),
    }));
  return seeOther(request, `/settings/sessions?signed_out=${ended ? 'browser' : 'gone'}`);
}
