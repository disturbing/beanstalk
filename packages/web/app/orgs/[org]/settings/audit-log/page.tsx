import { OrgSettingsFrame } from '../../../../../components/orgs/org-settings-frame';
import styles from '../../../../../components/repository/repository.module.css';
import { SettingsSection } from '../../../../../components/settings/settings-shell';
import type { OrgParams } from '../../../../../src/server/org-settings';
import { orgSettings, orgSettingsMetadata } from '../../../../../src/server/org-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = orgSettingsMetadata('Audit log');

const DATE = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** Org Settings → Audit log (owners and admins): who changed what, newest first, in UTC. */
export default async function OrgAuditSettingsPage(props: { readonly params: OrgParams }) {
  const settings = await orgSettings(props.params, 'audit-log');
  return (
    <OrgSettingsFrame
      settings={settings}
      current="audit-log"
      title="Audit log"
      lede="Settings, members and repositories moving in or out, newest first. Times are UTC."
    >
      <SettingsSection id="audit" title="Events">
        {settings.audit.length === 0 ? (
          <p className={styles.empty}>Nothing yet.</p>
        ) : (
          <ul className={styles.auditLog}>
            {settings.audit.map((event) => (
              <li key={`${event.at}-${event.action}-${event.targetHandle ?? ''}`}>
                <time dateTime={new Date(event.at).toISOString()}>
                  {DATE.format(new Date(event.at))}
                </time>{' '}
                {auditText(event)}
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>
    </OrgSettingsFrame>
  );
}

const VERBS: Readonly<Record<string, string>> = {
  'org.create': 'created the organization',
  'org.settings': 'changed settings',
  'member.invite': 'invited',
  'member.invite_cancel': 'cancelled the invitation of',
  'member.accept': 'joined',
  'member.decline': 'declined the invitation',
  'member.role': 'changed the role of',
  'member.remove': 'removed',
  'member.leave': 'left',
  'repository.create': 'created the repository',
  'repository.transfer_in': 'moved in',
  'repository.transfer_out': 'moved out',
};

function auditText(event: {
  readonly actorHandle: string;
  readonly action: string;
  readonly targetHandle: string | null;
  readonly detail: string;
}): string {
  const verb = VERBS[event.action] ?? event.action;
  const self = event.targetHandle === null || event.targetHandle === event.actorHandle;
  const target = self ? '' : ` @${event.targetHandle ?? ''}`;
  const detail = event.detail === '' ? '' : ` (${event.detail})`;
  return `@${event.actorHandle} ${verb}${target}${detail}`;
}
