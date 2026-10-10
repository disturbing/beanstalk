import { env } from 'cloudflare:workers';

import { clientIp } from '@gitstalk/shared-identity/request-context';
import { getWebSession } from '@gitstalk/shared-identity/sessions';
import { MAX_IMAGE_BYTES } from '@gitstalk/shared-media/images';

import { replacePictureFlow } from '../../../../src/account/account-flows';
import { avatarPorts } from '../../../../src/account/account-services';
import { pictureNoteParam } from '../../../../src/account/picture-notes';
import { seeOther, signedInForm } from '../../../../src/auth/http';

/** Room for the multipart envelope around a file at the size limit. */
const ENVELOPE_BYTES = 64 * 1024;

/** A new profile picture: stored in R2, saved on the profile, the old one deleted. */
export async function POST(request: Request): Promise<Response> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_IMAGE_BYTES + ENVELOPE_BYTES)
    return seeOther(request, `/settings?${pictureNoteParam('too_large')}`);
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const { user } = checked.session;
  const result = await replacePictureFlow(
    { kind: 'user', ownerId: user.id },
    checked.form.get('file'),
    avatarPorts({ id: user.id, ip: clientIp(request) }),
  );
  return seeOther(request, `/settings?${pictureNoteParam(result.code)}`);
}
