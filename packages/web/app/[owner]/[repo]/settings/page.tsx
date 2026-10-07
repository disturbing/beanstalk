import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollaboratorsSettings } from '../../../../components/repository/collaborators';
import { DeployTokens } from '../../../../components/repository/deploy-tokens';
import { currentSession } from '../../../../src/auth/user';
import { collaboratorsClient } from '../../../../src/repositories/collaborators-client';
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

/**
 * Settings. The owner has all of it; a maintainer has deploy tokens; other collaborators are
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
  const [tokens, people] = await Promise.all([
    canDeploy ? deployTokensClient(env.GATEWAY).list(actor, record.id) : Promise.resolve(null),
    isOwner ? collaboratorsClient(env.GATEWAY).people(record.id, actor.id) : Promise.resolve(null),
  ]);
  const repo = {
    id: record.id,
    owner: record.owner.handle,
    name: record.name,
    description: record.description,
    visibility: record.visibility,
  };
  const saved = (await searchParams)['saved'] === 'renamed' ? `Renamed to ${record.name}.` : null;
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
          {isOwner ? null : (
            <section className={`${styles.panel} ${styles.settingsSection}`}>
              <h2>Settings</h2>
              <p className={styles.sub}>
                You are <b>{role}</b> on {record.name}. Its name, visibility, people and deletion
                are <b>@{record.owner.handle}</b>&rsquo;s.{' '}
                {canDeploy ? 'As a maintainer you manage its deploy tokens below. ' : null}
                <Link href={`${base}/people`}>See who has access</Link>.
              </p>
            </section>
          )}
          {isOwner ? <GeneralSettings repo={repo} saved={saved} /> : null}
          {isOwner ? <VisibilitySettings repo={repo} /> : null}
          {isOwner && people !== null && people.ok ? (
            <CollaboratorsSettings
              name={record.name}
              collaborators={people.value.collaborators}
              invitations={people.value.invitations}
              audit={people.value.audit}
              access={access}
            />
          ) : null}
          {tokens === null ? null : (
            <DeployTokens tokens={tokens.ok ? tokens.value : []} access={access} />
          )}
          {isOwner ? <DangerZone repo={repo} /> : null}
        </div>
      </div>
    </main>
  );
}
