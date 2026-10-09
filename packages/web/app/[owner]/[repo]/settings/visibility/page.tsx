import { RepositorySettingsFrame } from '../../../../../components/repository/repository-settings-frame';
import { VisibilitySettings } from '../../../../../components/repository/settings-forms';
import type { RepositoryParams } from '../../../../../src/server/repository-page';
import {
  repositorySettings,
  settingsMetadata,
} from '../../../../../src/server/repository-settings';
import { settingsRepo } from '../../../../../src/settings/settings-repo';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = settingsMetadata('Visibility');

/** Settings → Visibility (the owner): public, private, or internal for an org's repository. */
export default async function VisibilitySettingsPage(props: { readonly params: RepositoryParams }) {
  const settings = await repositorySettings(props.params, 'visibility');
  return (
    <RepositorySettingsFrame
      settings={settings}
      current="visibility"
      title="Visibility"
      lede="Who can find, read and clone it. Pushing always needs a role."
    >
      <VisibilitySettings repo={settingsRepo(settings.record)} />
    </RepositorySettingsFrame>
  );
}
