/**
 * Where the code sends a browser after a settings change it cannot answer in place (a rename
 * moves the address, an upload is a plain multipart POST): the section's own page, with the
 * `?saved=` or `?picture=` line that page shows.
 */
import { orgSettingsPath, repoSettingsPath } from './sections';

export function pathsAfterSave(base: string) {
  return {
    renamed: `${repoSettingsPath(base, 'general')}?saved=renamed`,
    transferred: `${repoSettingsPath(base, 'general')}?saved=transferred`,
    archived: `${repoSettingsPath(base, 'danger')}?saved=archived`,
    unarchived: `${repoSettingsPath(base, 'danger')}?saved=unarchived`,
    /** `query` is the picture note (`picture=saved`, from `pictureNoteParam`). */
    socialImage: (query: string) => `${repoSettingsPath(base, 'social-image')}?${query}`,
  } as const;
}

/** An org's General page with the icon upload's note. */
export function orgIconPath(handle: string, query: string): string {
  return `${orgSettingsPath(handle, 'general')}?${query}`;
}
