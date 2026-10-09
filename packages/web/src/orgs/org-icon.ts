/**
 * Where an org's icon is served from. Orgs store only the key `@beanstalk/shared-media`
 * returns (`orgs/<id>/icon/<hash>`); the web host serves it under `/media/<key>[/<width>]`
 * (`docs/claude-opus/29-settings.md` §2), at the smallest stored width that covers `size`.
 */
import { imageUrl } from '@beanstalk/shared-media/images';

export function orgIconSrc(iconKey: string, size?: number): string {
  return imageUrl(iconKey, size);
}
