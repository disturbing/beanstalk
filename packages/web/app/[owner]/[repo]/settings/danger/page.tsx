import { TransferRepository } from '../../../../../components/orgs/org-forms';
import { RepositorySettingsFrame } from '../../../../../components/repository/repository-settings-frame';
import { ArchiveSettings, DangerZone } from '../../../../../components/repository/settings-forms';
import { transferTargets } from '../../../../../src/orgs/org-page';
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
export const generateMetadata = settingsMetadata('Danger zone');

/** What the page says after an archive or unarchive (`?saved=`). */
const ARCHIVE_SAVED: Readonly<Record<string, string>> = {
  archived: 'Archived.',
  unarchived: 'Unarchived: pushes are accepted again.',
};

/**
 * Settings → Danger zone (the owner): archive or unarchive, transfer, delete. Archive and
 * transfer ask in a dialog first; delete asks for the full name to be typed.
 */
export default async function DangerZoneSettingsPage(props: {
  readonly params: RepositoryParams;
  readonly searchParams: SettingsQuery;
}) {
  const settings = await repositorySettings(props.params, 'danger');
  const { record, actor, session } = settings;
  const savedParam = queryValue(await props.searchParams, 'saved');
  const orgTargets = await transferTargets(actor.id);
  // Anywhere it may go but where it is: the person themself, and orgs they administer.
  const targets = [
    { handle: actor.handle, label: `${actor.handle} (you)` },
    ...orgTargets.map((org) => ({ handle: org.handle, label: `${org.handle} (${org.name})` })),
  ].filter((target) => target.handle.toLowerCase() !== record.owner.handle.toLowerCase());
  const repo = settingsRepo(record);
  return (
    <RepositorySettingsFrame
      settings={settings}
      current="danger"
      title="Danger zone"
      lede="Changes here are hard or impossible to undo. Each one asks before it acts."
    >
      <ArchiveSettings
        repo={repo}
        archivedAt={record.archived_at}
        saved={ARCHIVE_SAVED[String(savedParam)] ?? null}
      />
      <TransferRepository
        repoId={record.id}
        fullName={`${record.owner.handle}/${record.name}`}
        targets={targets}
        csrf={session.csrfToken}
        isInternal={record.visibility === 'internal'}
      />
      <DangerZone repo={repo} />
    </RepositorySettingsFrame>
  );
}
