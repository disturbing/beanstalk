import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SecretsSettings } from '../../../../components/actions/secrets-settings';
import { ChecksSummary } from '../../../../components/repository/checks-config';
import { CollaboratorsSettings } from '../../../../components/repository/collaborators';
import { DeployTokens } from '../../../../components/repository/deploy-tokens';
import { currentSession } from '../../../../src/auth/user';
import { collaboratorsClient } from '../../../../src/repositories/collaborators-client';
import { deployTokensClient } from '../../../../src/repositories/deploy-tokens-client';
import { registryClient } from '../../../../src/repositories/registry-client';

import { RepoHead } from '../../../../components/home/repo-head';
import styles from '../../../../components/repository/repository.module.css';
import {
  ArchiveSettings,
  DangerZone,
  GeneralSettings,
  VisibilitySettings,
} from '../../../../components/repository/settings-forms';
import { actionsSession } from '../../../../src/server/actions-source';
import type { RepositoryParams } from '../../../../src/server/repository-page';
import { repositoryPage } from '../../../../src/server/repository-page';

/** What Settings says after an archive or unarchive (`?saved=`). */
const ARCHIVE_SAVED: Readonly<Record<string, string>> = {
  archived: 'Archived.',
  unarchived: 'Unarchived: pushes are accepted again.',
};

type PageProps = {
  readonly params: RepositoryParams;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo } = await params;
  return { title: `Settings, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}` };
}

/**
 * Settings. Everyone with a role sees the repository's effective checks (read from the stalk's
 * `.beanstalk/checks.toml`; changed by a maintainer's bean, never here). The owner has all of it; a maintainer has deploy tokens and Actions secrets (when Actions run here); other collaborators are
 * told whose settings these are; people with no role get the same 404 as a missing repository.
 * The gateway checks every change again.
 */
export default async function RepositorySettingsPage({ params, searchParams }: PageProps) {
  const page = await repositoryPage(params);
  const { record, base, role } = page;
  if (role === null) notFound();
  const session = await currentSession();
  if (session === null) notFound();
  const actor = { id: session.user.id, handle: session.user.handle };
  const access = { repoId: record.id, csrf: session.csrfToken, path: `${base}/settings` };
  const isOwner = role === 'owner';
  const canDeploy = isOwner || role === 'maintain';
  const actions = canDeploy ? await actionsSession({ actor, repoId: record.id }) : null;
  const [tokens, people, files, secrets] = await Promise.all([
    canDeploy ? deployTokensClient(env.GATEWAY).list(actor, record.id) : Promise.resolve(null),
    isOwner ? collaboratorsClient(env.GATEWAY).people(record.id, actor.id) : Promise.resolve(null),
    registryClient(env.GATEWAY).files(record.id, actor.id),
    actions === null ? Promise.resolve(null) : actions.client.secrets(),
  ]);
  const repo = {
    id: record.id,
    owner: record.owner.handle,
    name: record.name,
    description: record.description,
    visibility: record.visibility,
  };
  const savedParam = (await searchParams)['saved'];
  const saved = savedParam === 'renamed' ? `Renamed to ${record.name}.` : null;
  const archiveSaved = ARCHIVE_SAVED[String(savedParam)] ?? null;
  const isArchived = record.archived_at !== null;
  return (
    <main>
      <RepoHead
        base={base}
        repository={{ owner: record.owner.handle, name: record.name }}
        current="settings"
        kind="repository"
        visibility={record.visibility}
        ownerHref={`/${record.owner.handle}`}
        archived={record.archived_at !== null}
      />
      <div className={`${styles.page} ${styles.narrow}`}>
        <div className={styles.settings}>
          {isOwner ? null : (
            <section className={`${styles.panel} ${styles.settingsSection}`}>
              <h2>Settings</h2>
              <p className={styles.sub}>
                You are <b>{role}</b> on {record.name}. Its name, visibility, people and deletion
                are <b>@{record.owner.handle}</b>&rsquo;s.{' '}
                {canDeploy && !isArchived
                  ? 'As a maintainer you manage its deploy tokens below. '
                  : null}
                <Link href={`${base}/people`}>See who has access</Link>.
              </p>
            </section>
          )}
          {isOwner && isArchived ? (
            <ArchiveSettings repo={repo} archivedAt={record.archived_at} saved={archiveSaved} />
          ) : null}
          {isOwner && !isArchived ? <GeneralSettings repo={repo} saved={saved} /> : null}
          {isOwner && !isArchived ? <VisibilitySettings repo={repo} /> : null}
          <section className={styles.panel} aria-labelledby="checks-title">
            <div className={styles.panelHead}>
              <h2 id="checks-title">Checks</h2>
              <span className={`${styles.muted} ${styles.mono}`}>
                .beanstalk/checks.toml on {files.ok ? files.value.ref : 'the stalk'}
              </span>
            </div>
            {files.ok ? (
              <ChecksSummary file={files.value.checks} />
            ) : (
              <p className={styles.empty}>The stalk could not be read: {files.error.message}</p>
            )}
          </section>
          {isOwner && people !== null && people.ok ? (
            <CollaboratorsSettings
              name={record.name}
              collaborators={people.value.collaborators}
              invitations={people.value.invitations}
              audit={people.value.audit}
              access={access}
            />
          ) : null}
          {secrets === null || isArchived ? null : (
            <section
              className={`${styles.panel} ${styles.settingsSection}`}
              aria-labelledby="actions-title"
            >
              <h2 id="actions-title">Actions</h2>
              <SecretsSettings
                secrets={secrets.ok ? secrets.value.secrets : null}
                error={secrets.ok ? null : secrets.error.message}
                usage={secrets.ok ? secrets.value.usage : null}
                canToggle={actions?.client.canToggleSecretWithoutValue ?? false}
                access={{ csrf: session.csrfToken, owner: record.owner.handle, name: record.name }}
                nowMs={Date.now()}
              />
            </section>
          )}
          {tokens === null || isArchived ? null : (
            <DeployTokens tokens={tokens.ok ? tokens.value : []} access={access} />
          )}
          {isOwner && !isArchived ? (
            <ArchiveSettings repo={repo} archivedAt={null} saved={archiveSaved} />
          ) : null}
          {isOwner ? <DangerZone repo={repo} /> : null}
        </div>
      </div>
    </main>
  );
}
