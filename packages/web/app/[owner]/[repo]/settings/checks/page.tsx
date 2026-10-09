import { env } from 'cloudflare:workers';

import { ChecksSummary } from '../../../../../components/repository/checks-config';
import { RepositorySettingsFrame } from '../../../../../components/repository/repository-settings-frame';
import styles from '../../../../../components/repository/repository.module.css';
import { SettingsSection } from '../../../../../components/settings/settings-shell';
import { registryClient } from '../../../../../src/repositories/registry-client';
import type { RepositoryParams } from '../../../../../src/server/repository-page';
import {
  repositorySettings,
  settingsMetadata,
} from '../../../../../src/server/repository-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = settingsMetadata('Checks');

/**
 * Settings → Checks (everyone with a role): the effective checks from the stalk's
 * `.beanstalk/checks.toml`, changed by a maintainer's bean, never here.
 */
export default async function ChecksSettingsPage(props: { readonly params: RepositoryParams }) {
  const settings = await repositorySettings(props.params, 'checks');
  const files = await registryClient(env.GATEWAY).files(settings.record.id, settings.actor.id);
  return (
    <RepositorySettingsFrame
      settings={settings}
      current="checks"
      title="Checks"
      lede="What must pass before a bean reaches the stalk. Change them with a bean that edits .beanstalk/checks.toml."
    >
      <SettingsSection
        id="checks"
        title="What counts as green"
        aside={
          <span className={`${styles.muted} ${styles.mono}`}>
            .beanstalk/checks.toml on {files.ok ? files.value.ref : 'the stalk'}
          </span>
        }
      >
        {files.ok ? (
          <ChecksSummary file={files.value.checks} />
        ) : (
          <p className={styles.empty}>The stalk could not be read: {files.error.message}</p>
        )}
      </SettingsSection>
    </RepositorySettingsFrame>
  );
}
