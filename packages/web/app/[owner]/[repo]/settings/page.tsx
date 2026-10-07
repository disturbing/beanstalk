import { env } from 'cloudflare:workers';
import { notFound } from 'next/navigation';

import { DeployTokens } from '../../../../components/repository/deploy-tokens';
import { currentSession } from '../../../../src/auth/user';
import { deployTokensClient } from '../../../../src/repositories/deploy-tokens-client';

import { RepoHead } from '../../../../components/home/repo-head';
import styles from '../../../../components/repository/repository.module.css';
import {
  DangerZone,
  GeneralSettings,
  VisibilitySettings,
} from '../../../../components/repository/settings-forms';
import type { RepositoryParams } from '../../../../src/server/repository-page';
import { repositoryPage } from '../../../../src/server/repository-page';

type PageProps = {
  readonly params: RepositoryParams;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo } = await params;
  return { title: `Settings, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}` };
}

/** Settings: the owner's only (others get the same 404 as a missing repository). */
export default async function RepositorySettingsPage({ params, searchParams }: PageProps) {
  const page = await repositoryPage(params);
  if (!page.isOwner) notFound();
  const { record, base } = page;
  const repo = {
    id: record.id,
    owner: record.owner.handle,
    name: record.name,
    description: record.description,
    visibility: record.visibility,
  };
  const saved = (await searchParams)['saved'] === 'renamed' ? `Renamed to ${record.name}.` : null;
  const session = await currentSession();
  const actor = { id: record.owner.id, handle: record.owner.handle };
  const tokens = await deployTokensClient(env.GATEWAY).list(actor, record.id);
  return (
    <main>
      <RepoHead
        base={base}
        repository={{ owner: record.owner.handle, name: record.name }}
        current="settings"
        kind="repository"
        visibility={record.visibility}
        ownerHref={`/${record.owner.handle}`}
      />
      <div className={`${styles.page} ${styles.narrow}`}>
        <div className={styles.settings}>
          <GeneralSettings repo={repo} saved={saved} />
          <VisibilitySettings repo={repo} />
          <section
            className={`${styles.panel} ${styles.settingsSection}`}
            aria-labelledby="people-title"
          >
            <h2 id="people-title">Collaborators</h2>
            <p className={styles.sub}>
              Only you, and the agent sessions you connect, can change {record.name} today. Inviting
              people arrives with accounts and teams.
            </p>
            <div className={styles.nameRow}>
              <input
                className={styles.input}
                placeholder="Handle or email"
                disabled
                aria-label="Invite by handle or email"
              />
              <button type="button" className={styles.secondary} disabled>
                Invite
              </button>
            </div>
          </section>
          {session === null ? null : (
            <DeployTokens
              tokens={tokens.ok ? tokens.value : []}
              access={{ repoId: record.id, csrf: session.csrfToken, path: `${base}/settings` }}
            />
          )}
          <DangerZone repo={repo} />
        </div>
      </div>
    </main>
  );
}
