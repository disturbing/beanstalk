import { env } from 'cloudflare:workers';

import { getWebSession } from '@beanstalk/shared-identity/sessions';
import { MAX_IMAGE_BYTES } from '@beanstalk/shared-media/images';

import { removePictureFlow, replacePictureFlow } from '../../../../../src/account/account-flows';
import type { PicturePorts } from '../../../../../src/account/account-flows';
import { webMedia } from '../../../../../src/account/account-services';
import { pictureNoteParam } from '../../../../../src/account/picture-notes';
import { seeOther, signedInForm } from '../../../../../src/auth/http';
import { repositoryPath } from '../../../../../src/repositories/paths';
import { registryClient } from '../../../../../src/repositories/registry-client';

type Context = { readonly params: Promise<{ readonly owner: string; readonly repo: string }> };

/** Room for the multipart envelope around a file at the size limit. */
const ENVELOPE_BYTES = 64 * 1024;

/**
 * The repository's social image (the picture link previews show): upload, or `remove=1`. The
 * owner only; the gateway checks again when the key is saved and refuses another repository's.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  const { owner, repo } = await context.params;
  const settings = `${repositoryPath(decodeURIComponent(owner), decodeURIComponent(repo))}/settings`;
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > MAX_IMAGE_BYTES + ENVELOPE_BYTES)
    return seeOther(request, `${settings}?${pictureNoteParam('too_large')}#social`);
  const checked = await signedInForm(request, (cookies) => getWebSession(cookies, env));
  if (checked instanceof Response) return checked;
  const { user } = checked.session;
  const registry = registryClient(env.GATEWAY);
  const found = await registry.get(decodeURIComponent(owner), decodeURIComponent(repo), user.id);
  if (!found.ok || found.value.viewer_role !== 'owner')
    return new Response('Not found', { status: 404 });
  const record = found.value;
  const media = webMedia();
  const ports: PicturePorts = {
    upload: (kind, ownerId, file) => media.uploadImage(kind, ownerId, file),
    save: async (key) => {
      const saved = await registry.update(user.id, record.id, { social_image_key: key });
      if (!saved.ok) throw new Error(`social image not saved: ${saved.error.code}`);
      return { previous: record.social_image_key === key ? null : record.social_image_key };
    },
    prune: (kind, ownerId, keep) => media.pruneImages(kind, ownerId, keep),
  };
  const target = { kind: 'repo', ownerId: record.id } as const;
  if (checked.form.get('remove') === '1') {
    await removePictureFlow(target, ports);
    return seeOther(request, `${settings}?${pictureNoteParam('removed')}#social`);
  }
  const result = await replacePictureFlow(target, checked.form.get('file'), ports);
  return seeOther(request, `${settings}?${pictureNoteParam(result.code)}#social`);
}
