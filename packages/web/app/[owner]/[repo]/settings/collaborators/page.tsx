import { env } from 'cloudflare:workers';

import { CollaboratorsSettings } from '../../../../../components/repository/collaborators';
import { RepositorySettingsFrame } from '../../../../../components/repository/repository-settings-frame';
import styles from '../../../../../components/repository/repository.module.css';
import { collaboratorsClient } from '../../../../../src/repositories/collaborators-client';
import type { RepositoryParams } from '../../../../../src/server/repository-page';
import {
  repositorySettings,
  settingsMetadata,
} from '../../../../../src/server/repository-settings';
import { repoSettingsPath } from '../../../../../src/settings/sections';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = settingsMetadata('Collaborators');

/** Settings → Collaborators (the owner): invite by handle, change roles, remove, cancel. */
export default async function CollaboratorsSettingsPage(props: {
  readonly params: RepositoryParams;
}) {
  const settings = await repositorySettings(props.params, 'collaborators');
  const { record, base, session, actor } = settings;
  const people = await collaboratorsClient(env.GATEWAY).people(record.id, actor.id);
  return (
    <RepositorySettingsFrame
      settings={settings}
      current="collaborators"
      title="Collaborators"
      lede="People invited to this repository and their roles. A role takes effect on their next request."
    >
      {people.ok ? (
        <CollaboratorsSettings
          name={record.name}
          collaborators={people.value.collaborators}
          invitations={people.value.invitations}
          audit={people.value.audit}
          access={{
            repoId: record.id,
            csrf: session.csrfToken,
            path: repoSettingsPath(base, 'collaborators'),
          }}
        />
      ) : (
        <p className={styles.empty}>Collaborators could not be loaded: {people.error.message}</p>
      )}
    </RepositorySettingsFrame>
  );
}
