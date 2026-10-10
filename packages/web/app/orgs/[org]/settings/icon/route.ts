import { env } from 'cloudflare:workers';

import { updateOrg } from '@gitstalk/shared-identity/org-admin';
import { findOrgByHandle, mayInOrg, orgRole } from '@gitstalk/shared-identity/orgs';
import { getWebSession } from '@gitstalk/shared-identity/sessions';
import { MAX_IMAGE_BYTES } from '@gitstalk/shared-media/images';

import type { PicturePorts } from '../../../../../src/account/account-flows';
import { removePictureFlow, replacePictureFlow } from '../../../../../src/account/account-flows';
import { webMedia } from '../../../../../src/account/account-services';
import { pictureNoteParam } from '../../../../../src/account/picture-notes';
import { seeOther, signedInForm } from '../../../../../src/auth/http';
import { orgIconPath } from '../../../../../src/settings/redirects';

type Context = { readonly params: Promise<{ readonly org: string }> };

/** Room for the multipart envelope around a file at the size limit. */
const ENVELOPE_BYTES = 64 * 1024;

/**
 * An organization's icon: upload (stored in R2 under `orgs/<id>/icon/<hash>`) or `remove=1`.
 * Owners and admins only (`mayInOrg(role, 'settings')`); `updateOrg` checks again and refuses
 * a key that is not this org's.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  const handle = decodeURIComponent((await context.params).org);
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_IMAGE_BYTES + ENVELOPE_BYTES)
    return seeOther(request, orgIconPath(handle, pictureNoteParam('too_large')));
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const { user } = checked.session;
  const org = await findOrgByHandle(env, handle);
  if (org === null || !mayInOrg(await orgRole(env, org.id, user.id), 'settings'))
    return new Response('Not found', { status: 404 });
  const media = webMedia();
  const ports: PicturePorts = {
    upload: (kind, ownerId, file) => media.uploadImage(kind, ownerId, file),
    save: async (key) => {
      const saved = await updateOrg(env, user, org.id, { iconKey: key }, Date.now());
      if (!saved.ok) throw new Error(`org icon not saved: ${saved.error.code}`);
      return { previous: org.iconKey === key ? null : org.iconKey };
    },
    prune: (kind, ownerId, keep) => media.pruneImages(kind, ownerId, keep),
  };
  const target = { kind: 'org', ownerId: org.id } as const;
  if (checked.form.get('remove') === '1') {
    await removePictureFlow(target, ports);
    return seeOther(request, orgIconPath(handle, pictureNoteParam('removed')));
  }
  const result = await replacePictureFlow(target, checked.form.get('file'), ports);
  return seeOther(request, orgIconPath(handle, pictureNoteParam(result.code)));
}
