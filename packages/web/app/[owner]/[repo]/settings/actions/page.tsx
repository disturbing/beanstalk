import { ActionsSwitchesForm } from '../../../../../components/actions/actions-switches-form';
import { RepositorySettingsFrame } from '../../../../../components/repository/repository-settings-frame';
import styles from '../../../../../components/repository/repository.module.css';
import { SettingsSection, SoonPill } from '../../../../../components/settings/settings-shell';
import { switchesOf } from '../../../../../src/actions/actions-switches';
import type { RepositoryParams } from '../../../../../src/server/repository-page';
import type { RepositorySettings } from '../../../../../src/server/repository-settings';
import {
  repositorySettings,
  settingsMetadata,
} from '../../../../../src/server/repository-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = settingsMetadata('Actions');

/**
 * Settings → Actions (maintainers and the owner): how jobs run here (the dependency cache, its
 * snapshot cap, npm's audit), saved as repository variables, and the features a repository
 * will switch on and off.
 */
export default async function ActionsSettingsPage(props: { readonly params: RepositoryParams }) {
  const settings = await repositorySettings(props.params, 'actions');
  return (
    <RepositorySettingsFrame
      settings={settings}
      current="actions"
      title="Actions"
      lede="How workflow and automation jobs run for this repository."
    >
      <JobSettings settings={settings} />
      <Features />
    </RepositorySettingsFrame>
  );
}

async function JobSettings({ settings }: { readonly settings: RepositorySettings }) {
  const { actions, record, session, isArchived } = settings;
  if (actions === null)
    return (
      <SettingsSection id="jobs" title="Jobs">
        <p className={styles.empty}>Actions are not running on this deployment.</p>
      </SettingsSection>
    );
  const entries = await actions.client.entries();
  if (!entries.ok)
    return (
      <SettingsSection id="jobs" title="Jobs">
        <p className={styles.empty}>The settings could not be read: {entries.error.message}</p>
      </SettingsSection>
    );
  const own = entries.value.variables.filter((entry) => entry.source.kind === 'repository');
  const access = isArchived
    ? null
    : { csrf: session.csrfToken, owner: record.owner.handle, name: record.name };
  return <ActionsSwitchesForm switches={switchesOf(own)} access={access} />;
}

/** What a repository will switch on and off; nothing is switchable yet. */
function Features() {
  const features = [
    ['Ask', 'questions about the code, answered from the stalk', true],
    ['Automations', 'Actions workflows from .beanstalk/workflows', true],
    ['Previews', 'a live preview per bean', false],
    ['Insights', 'landing rate, waiting time and rework per person and agent', false],
  ] as const;
  return (
    <SettingsSection
      id="features"
      title="Features"
      aside={<SoonPill>Not switchable yet</SoonPill>}
      lede="Every repository has the same features today."
    >
      <div className={styles.toggles}>
        {features.map(([name, detail, isOn]) => (
          <label key={name} className={styles.toggle}>
            <input type="checkbox" disabled defaultChecked={isOn} />
            <span>
              <b>{name}</b> · {detail}
            </span>
            <span className={styles.muted}>{isOn ? 'on' : 'coming'}</span>
          </label>
        ))}
      </div>
    </SettingsSection>
  );
}
