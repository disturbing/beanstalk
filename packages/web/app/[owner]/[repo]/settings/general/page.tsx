import { RepositorySettingsFrame } from '../../../../../components/repository/repository-settings-frame';
import { GeneralSettings } from '../../../../../components/repository/settings-forms';
import { queryValue } from '../../../../../src/server/account-page';
import type { RepositoryParams } from '../../../../../src/server/repository-page';
import type { SettingsQuery } from '../../../../../src/server/repository-settings';
import {
  repositorySettings,
  settingsMetadata,
} from '../../../../../src/server/repository-settings';
import { settingsRepo } from '../../../../../src/settings/settings-repo';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = settingsMetadata('General');

/** Settings → General (the owner): name, description, website and topics, one Save. */
export default async function GeneralSettingsPage(props: {
  readonly params: RepositoryParams;
  readonly searchParams: SettingsQuery;
}) {
  const settings = await repositorySettings(props.params, 'general');
  const { record } = settings;
  const savedParam = queryValue(await props.searchParams, 'saved');
  const saved = savedLine(savedParam, `${record.owner.handle}/${record.name}`);
  return (
    <RepositorySettingsFrame
      settings={settings}
      current="general"
      title="General"
      lede="How the repository is named and described on its page and in lists."
    >
      <GeneralSettings repo={settingsRepo(record)} saved={saved} />
    </RepositorySettingsFrame>
  );
}

/** The line after a redirect here (`?saved=renamed` or `?saved=transferred`). */
function savedLine(saved: string | undefined, fullName: string): string | null {
  if (saved === 'renamed') return `Renamed: it is now ${fullName}. The old address redirects here.`;
  if (saved === 'transferred')
    return `Transferred: it now lives at ${fullName}. The old address redirects here.`;
  return null;
}
