import { notFound, redirect } from 'next/navigation';

import { OrgSecretsSettings } from '../../../../../components/actions/org-secrets-settings';
import styles from '../../../../../components/repository/repository.module.css';
import { currentSession } from '../../../../../src/auth/user';
import { orgActionsFor } from '../../../../../src/server/org-actions-source';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

type PageProps = { readonly params: Promise<{ readonly org: string }> };

export async function generateMetadata({ params }: PageProps) {
  const { org } = await params;
  return { title: `Secrets and variables, ${decodeURIComponent(org)}` };
}

/**
 * Org Settings → Secrets and variables (GitHub's `/orgs/<org>/settings/secrets`):
 * the org's Actions secrets by name and its variables, each with the repositories it reaches.
 * Org members read; owners and admins add, change and delete (the gateway checks again).
 * People outside the org get the same 404 as a missing org.
 */
export default async function OrgSecretsPage({ params }: PageProps) {
  const orgHandle = decodeURIComponent((await params).org);
  const path = `/orgs/${encodeURIComponent(orgHandle)}/settings/secrets`;
  const session = await currentSession();
  if (session === null) redirect(`/login?next=${encodeURIComponent(path)}`);
  const client = orgActionsFor({ viewer: session.user.id, orgHandle });
  if (client === null) notFound();
  const settings = await client.settings();
  if (!settings.ok) {
    if (settings.error.code === 'not_found') notFound();
    return (
      <main className={`${styles.page} ${styles.narrow}`}>
        <p className={styles.empty}>Org settings could not be read: {settings.error.message}</p>
      </main>
    );
  }
  return (
    <main>
      <div className={`${styles.page} ${styles.narrow}`}>
        <h1>@{settings.value.org.handle}</h1>
        <p className={styles.sub}>Organization settings · Secrets and variables for Actions</p>
        <div className={styles.settings}>
          <OrgSecretsSettings
            settings={settings.value}
            access={
              settings.value.canManage
                ? { csrf: session.csrfToken, org: settings.value.org.handle }
                : null
            }
            nowMs={Date.now()}
          />
        </div>
      </div>
    </main>
  );
}
