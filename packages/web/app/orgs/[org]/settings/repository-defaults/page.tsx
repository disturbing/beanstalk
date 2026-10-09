import { OrgRepositoryDefaults } from '../../../../../components/orgs/org-forms';
import { OrgSettingsFrame } from '../../../../../components/orgs/org-settings-frame';
import type { OrgParams } from '../../../../../src/server/org-settings';
import { orgSettings, orgSettingsMetadata } from '../../../../../src/server/org-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = orgSettingsMetadata('Repository defaults');

/**
 * Org Settings → Repository defaults (owners and admins): the base permission for members,
 * who creates repositories, and new repositories' visibility, in one form.
 */
export default async function OrgDefaultsSettingsPage(props: { readonly params: OrgParams }) {
  const settings = await orgSettings(props.params, 'repository-defaults');
  return (
    <OrgSettingsFrame
      settings={settings}
      current="repository-defaults"
      title="Repository defaults"
      lede="What members may do with the organization's repositories. A change applies on their next request."
    >
      <OrgRepositoryDefaults
        org={settings.org}
        access={{ csrf: settings.session.csrfToken, path: settings.path }}
      />
    </OrgSettingsFrame>
  );
}
