import { notFound } from 'next/navigation';

import { OrgSecretsSettings } from '../../../../../components/actions/org-secrets-settings';
import { OrgSettingsFrame } from '../../../../../components/orgs/org-settings-frame';
import styles from '../../../../../components/repository/repository.module.css';
import { orgActionsFor } from '../../../../../src/server/org-actions-source';
import type { OrgParams } from '../../../../../src/server/org-settings';
import { orgSettings, orgSettingsMetadata } from '../../../../../src/server/org-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = orgSettingsMetadata('Secrets and variables');

/**
 * Org Settings → Secrets and variables (GitHub's `/orgs/<org>/settings/secrets`): the org's
 * Actions secrets by name and its variables, each with the repositories it reaches. Members
 * read; owners and admins add, change and delete (the gateway checks again).
 */
export default async function OrgSecretsPage(props: { readonly params: OrgParams }) {
  const settings = await orgSettings(props.params, 'secrets');
  const { org, session } = settings;
  const client = orgActionsFor({ viewer: session.user.id, orgHandle: org.handle });
  const loaded = client === null ? null : await client.settings();
  if (loaded !== null && !loaded.ok && loaded.error.code === 'not_found') notFound();
  return (
    <OrgSettingsFrame
      settings={settings}
      current="secrets"
      title="Secrets and variables"
      lede={`Actions secrets and variables for ${org.name}'s repositories: all of them, the private ones, or the ones you pick.`}
    >
      <SecretsBody loaded={loaded} csrf={session.csrfToken} />
    </OrgSettingsFrame>
  );
}

type Loaded = Awaited<ReturnType<NonNullable<ReturnType<typeof orgActionsFor>>['settings']>>;

function SecretsBody({ loaded, csrf }: { readonly loaded: Loaded | null; readonly csrf: string }) {
  if (loaded === null)
    return <p className={styles.empty}>Actions are not running on this deployment.</p>;
  if (!loaded.ok)
    return <p className={styles.empty}>Org settings could not be read: {loaded.error.message}</p>;
  return (
    <OrgSecretsSettings
      settings={loaded.value}
      access={loaded.value.canManage ? { csrf, org: loaded.value.org.handle } : null}
      nowMs={Date.now()}
    />
  );
}
