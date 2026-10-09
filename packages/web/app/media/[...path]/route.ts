import { env } from 'cloudflare:workers';

import { serveImage } from '@beanstalk/shared-media/images';

type Context = { readonly params: Promise<{ readonly path: readonly string[] }> };

/**
 * Uploaded pictures from R2 (`/media/<key>[/<width>]`): content-hash keys, so a year of
 * immutable caching; anything that is not an image key is a 404 (@beanstalk/shared-media).
 */
export async function GET(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  return serveImage(env, request, path.map((segment) => decodeURIComponent(segment)).join('/'));
}

export const HEAD = GET;
