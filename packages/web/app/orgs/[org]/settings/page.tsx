import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  OrgDangerZone,
  OrgGeneralSettings,
  OrgRepositoryDefaults,
} from '../../../../components/orgs/org-forms';
import { OrgMark } from '../../../../components/orgs/org-mark';
import { PictureSection } from '../../../../components/settings/picture-section';
import { LeaveOrg, OrgMembersSettings } from '../../../../components/orgs/org-people';
import orgStyles from '../../../../components/orgs/orgs.module.css';
import styles from '../../../../components/repository/repository.module.css';
import { pictureNote } from '../../../../src/account/picture-notes';
import { currentSession } from '../../../../src/auth/user';
import { orgPage } from '../../../../src/orgs/org-page';
import { registryClient } from '../../../../src/repositories/registry-client';
import { queryValue } from '../../../../src/server/account-page';

type PageProps = {
  readonly params: Promise<{ readonly org: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export async function generateMetadata({ params }: PageProps) {
  return { title: `Settings, ${decodeURIComponent((await params).org)}` };
}

const DATE = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/**
 * Org Settings, for owners and admins: General, Members & invitations, Repository defaults,
 * the audit log and (owners) the Danger zone. Members see a Leave button and whose settings
 * these are; everyone else gets the 404 page. Every change is checked again on save.
 */
export default async function OrgSettingsPage({ params, searchParams }: PageProps) {
  const handle = decodeURIComponent((await params).org);
  const session = await currentSession();
  if (session === null) notFound();
  const page = await orgPage(handle, session.user.id);
  if (page === null || page.role === null) notFound();
  const { org, role } = page;
  const path = `/orgs/${org.handle}/settings`;
  const access = { csrf: session.csrfToken, path };
  const manages = role === 'owner' || role === 'admin';
  const repositories = role === 'owner' ? await ownedCount(org.id, session.user.id) : 0;
  return (
    <main className={`${styles.page} ${styles.narrow}`}>
      <header className={orgStyles.head}>
        <OrgMark handle={org.handle} iconKey={org.iconKey} size={44} />
        <div className={orgStyles.headText}>
          <h1>Settings</h1>
          <span className={orgStyles.handle}>
            <Link href={`/${org.handle}`}>{org.name}</Link> · you are {role}
          </span>
        </div>
      </header>
      <div className={styles.settings}>
        {manages ? null : (
          <section className={`${styles.panel} ${styles.settingsSection}`}>
            <h2>Settings</h2>
            <p className={styles.sub}>
              {org.name}&rsquo;s settings and members are managed by its owners and admins.
            </p>
          </section>
        )}
        {manages ? <OrgGeneralSettings org={org} access={access} /> : null}
        {manages ? (
          <PictureSection
            id="icon"
            title="Icon"
            lede="Shown beside the organization's name on its page, its repositories and in menus. Square works best; PNG, JPEG, WebP or GIF up to 2 MB."
            action={`${path}/icon`}
            csrf={session.csrfToken}
            hasPicture={org.iconKey !== null}
            note={pictureNote(queryValue(await searchParams, 'picture'))}
            removeLabel="Remove icon (use the letters)"
            current={<OrgMark handle={org.handle} iconKey={org.iconKey} size={96} />}
          />
        ) : null}
        {manages ? (
          <OrgMembersSettings
            orgHandle={org.handle}
            members={page.members}
            invitations={page.invitations}
            viewerId={session.user.id}
            access={{ ...access, orgId: org.id, viewerRole: role }}
          />
        ) : null}
        {manages ? <OrgRepositoryDefaults org={org} access={access} /> : null}
        <section className={`${styles.panel} ${styles.settingsSection}`}>
          <h2>Secrets and variables</h2>
          <p className={styles.sub}>
            Actions secrets and variables for {org.name}&rsquo;s repositories: all of them, the
            private ones, or the ones you pick.{' '}
            <Link href={`/orgs/${encodeURIComponent(org.handle)}/settings/secrets`}>
              {manages ? 'Manage secrets and variables' : 'See secrets and variables'}
            </Link>
          </p>
        </section>
        {page.audit.length === 0 ? null : (
          <section className={`${styles.panel} ${styles.settingsSection}`}>
            <h2>Audit log</h2>
            <ul className={styles.auditLog}>
              {page.audit.map((event) => (
                <li key={`${event.at}-${event.action}-${event.targetHandle ?? ''}`}>
                  <time dateTime={new Date(event.at).toISOString()}>
                    {DATE.format(new Date(event.at))}
                  </time>{' '}
                  {auditText(event)}
                </li>
              ))}
            </ul>
          </section>
        )}
        <section className={`${styles.panel} ${styles.settingsSection}`}>
          <h2>Leave</h2>
          <p className={styles.sub}>
            You lose your {role} role at once. The last owner names another owner first.
          </p>
          <LeaveOrg
            orgId={org.id}
            orgHandle={org.handle}
            userId={session.user.id}
            csrf={session.csrfToken}
          />
        </section>
        {role === 'owner' ? (
          <OrgDangerZone org={org} access={access} repositories={repositories} />
        ) : null}
      </div>
    </main>
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
