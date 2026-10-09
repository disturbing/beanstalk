import { OrgMembersSettings } from '../../../../../components/orgs/org-people';
import { OrgSettingsFrame } from '../../../../../components/orgs/org-settings-frame';
import type { OrgParams } from '../../../../../src/server/org-settings';
import { orgSettings, orgSettingsMetadata } from '../../../../../src/server/org-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = orgSettingsMetadata('Members and invitations');

/** Org Settings → Members and invitations (owners and admins): invite, roles, remove, cancel. */
export default async function OrgMembersSettingsPage(props: { readonly params: OrgParams }) {
  const settings = await orgSettings(props.params, 'members');
  const { org, role, session, path } = settings;
  return (
    <OrgSettingsFrame
      settings={settings}
      current="members"
      title="Members and invitations"
      lede="Who belongs to the organization and with which role. Invitations are accepted on the invitee's Home."
    >
      <OrgMembersSettings
        orgHandle={org.handle}
        members={settings.members}
        invitations={settings.invitations}
        viewerId={session.user.id}
        access={{ csrf: session.csrfToken, path, orgId: org.id, viewerRole: role }}
      />
    </OrgSettingsFrame>
  );
}
