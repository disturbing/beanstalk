import { RepositorySettingsFrame } from '../../../../../components/repository/repository-settings-frame';
import styles from '../../../../../components/repository/repository.module.css';
import { SettingsSection } from '../../../../../components/settings/settings-shell';
import type { RepositoryParams } from '../../../../../src/server/repository-page';
import {
  repositorySettings,
  settingsMetadata,
} from '../../../../../src/server/repository-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = settingsMetadata('Branches');

/** Settings → Branches (everyone with a role): the fixed branch layout, nothing to change. */
export default async function BranchesSettingsPage(props: { readonly params: RepositoryParams }) {
  const settings = await repositorySettings(props.params, 'branches');
  return (
    <RepositorySettingsFrame
      settings={settings}
      current="branches"
      title="Branches"
      lede="Beans land on the sprout; the stalk is what passed validation on the merged tree. People and agents push bean/* branches only."
    >
      <SettingsSection id="branches" title="Branch layout">
        <dl className={styles.branchFacts}>
          <dt>Default branch</dt>
          <dd className={styles.mono}>{settings.record.default_branch}</dd>
          <dt>Landing line</dt>
          <dd className={styles.mono}>sprout</dd>
          <dt>Pushable</dt>
          <dd className={styles.mono}>bean/*</dd>
        </dl>
        <p className={styles.hint}>
          The default branch is fixed to the stalk: clones check it out, and nobody pushes to it.
        </p>
      </SettingsSection>
    </RepositorySettingsFrame>
  );
}
