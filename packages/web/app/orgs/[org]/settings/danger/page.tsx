import { env } from 'cloudflare:workers';

import { OrgDangerZone } from '../../../../../components/orgs/org-forms';
import { LeaveOrg } from '../../../../../components/orgs/org-people';
import { OrgSettingsFrame } from '../../../../../components/orgs/org-settings-frame';
import { SettingsSection } from '../../../../../components/settings/settings-shell';
import { registryClient } from '../../../../../src/repositories/registry-client';
import type { OrgParams } from '../../../../../src/server/org-settings';
import { orgSettings, orgSettingsMetadata } from '../../../../../src/server/org-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = orgSettingsMetadata('Danger zone');

/**
 * Org Settings → Danger zone: everyone may leave (after a confirmation; the last owner is told
 * to name another first); owners delete the org once it owns no repositories, after typing
 * its handle.
 */
export default async function OrgDangerSettingsPage(props: { readonly params: OrgParams }) {
  const settings = await orgSettings(props.params, 'danger');
  const { org, role, session, path } = settings;
  const repositories = role === 'owner' ? await ownedCount(org.id, session.user.id) : 0;
  return (
    <OrgSettingsFrame
      settings={settings}
      current="danger"
      title="Danger zone"
      lede="Leaving or deleting takes effect at once. Each asks before it acts."
    >
      <SettingsSection
        id="leave"
        title={`Leave ${org.name}`}
        tone="danger"
        lede={`You lose your ${role} role at once. The last owner names another owner first.`}
      >
        <LeaveOrg
          orgId={org.id}
          orgHandle={org.handle}
          userId={session.user.id}
          csrf={session.csrfToken}
        />
      </SettingsSection>
      {role === 'owner' ? (
        <OrgDangerZone
          org={org}
          access={{ csrf: session.csrfToken, path }}
          repositories={repositories}
        />
      ) : null}
    </OrgSettingsFrame>
  );
}

async function ownedCount(orgId: string, viewerId: string): Promise<number> {
  const registry = registryClient(env.GATEWAY);
  const [active, archived] = await Promise.all([
    registry.list(orgId, viewerId),
    registry.list(orgId, viewerId, 'archived'),
  ]);
  return (active.ok ? active.value.length : 0) + (archived.ok ? archived.value.length : 0);
}
