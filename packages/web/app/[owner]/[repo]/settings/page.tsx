import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { SecretsSettings } from '../../../../components/actions/secrets-settings';
import { VariablesSettings } from '../../../../components/actions/variables-settings';
import { TransferRepository } from '../../../../components/orgs/org-forms';
import { ChecksSummary } from '../../../../components/repository/checks-config';
import { CollaboratorsSettings } from '../../../../components/repository/collaborators';
import { DeployTokens } from '../../../../components/repository/deploy-tokens';
import { currentSession } from '../../../../src/auth/user';
import { transferTargets } from '../../../../src/orgs/org-page';
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
import type {
  RepoEntries,
  SecretList,
  SecretSummary,
} from '../../../../src/actions/actions-contract';
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
 * `.beanstalk/checks.toml`; changed by a maintainer's bean, never here). The owner has all of it; a maintainer has deploy tokens and Actions secrets and variables (when Actions run here);
 * other collaborators see secret names and variables read-only and are told whose settings these are; people with no role get the same 404 as a missing repository.
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
  const isArchived = record.archived_at !== null;
  const canDeploy = isOwner || role === 'maintain';
  const actions = await actionsSession({ actor, repoId: record.id });
  const [tokens, people, files, secrets, entries, orgTargets] = await Promise.all([
    canDeploy ? deployTokensClient(env.GATEWAY).list(actor, record.id) : Promise.resolve(null),
    isOwner ? collaboratorsClient(env.GATEWAY).people(record.id, actor.id) : Promise.resolve(null),
    registryClient(env.GATEWAY).files(record.id, actor.id),
    actions === null || !canDeploy ? Promise.resolve(null) : actions.client.secrets(),
    actions === null ? Promise.resolve(null) : actions.client.entries(),
    isOwner ? transferTargets(actor.id) : Promise.resolve([]),
  ]);
  const actionsAccess =
    canDeploy && !isArchived
      ? { csrf: session.csrfToken, owner: record.owner.handle, name: record.name }
      : null;
  // Anywhere it may go but where it is: the person themself, and orgs they administer.
  const targets = [
    { handle: actor.handle, label: `${actor.handle} (you)` },
    ...orgTargets.map((org) => ({ handle: org.handle, label: `${org.handle} (${org.name})` })),
  ].filter((target) => target.handle.toLowerCase() !== record.owner.handle.toLowerCase());
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
                are <b>@{record.owner.handle}</b>&rsquo;s
                {record.owner_kind === 'org' ? ' (its owners and admins)' : ''}.{' '}
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
          {actions === null ? null : (
            <section
              className={`${styles.panel} ${styles.settingsSection}`}
              aria-labelledby="actions-title"
            >
              <h2 id="actions-title">Secrets and variables</h2>
              <SecretsSettings
                secrets={ownSecrets(secrets, entries)}
                inherited={inheritedOf(entries).secrets}
                error={entriesError(secrets, entries)}
                usage={secrets?.ok === true ? secrets.value.usage : null}
                canToggle={actions.client.canToggleSecretWithoutValue}
                access={actionsAccess}
                nowMs={Date.now()}
              />
              <VariablesSettings
                own={entries?.ok === true ? entries.value.variables.filter(isOwn) : []}
                inherited={inheritedOf(entries).variables}
                access={actionsAccess}
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
          {isOwner ? (
            <TransferRepository
              repoId={record.id}
              fullName={`${record.owner.handle}/${record.name}`}
              targets={targets}
              csrf={session.csrfToken}
            />
          ) : null}
          {isOwner ? <DangerZone repo={repo} /> : null}
        </div>
      </div>
    </main>
  );
}

type Listed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } };

/** The repository's own secrets: the full list for maintainers, names from the entries otherwise. */
function ownSecrets(
  secrets: Listed<SecretList> | null,
  entries: Listed<RepoEntries> | null,
): readonly SecretSummary[] | null {
  if (secrets?.ok === true) return secrets.value.secrets;
  if (entries?.ok === true) return entries.value.secrets.filter(isOwn);
  return null;
}

function inheritedOf(entries: Listed<RepoEntries> | null): {
  readonly secrets: RepoEntries['secrets'];
  readonly variables: RepoEntries['variables'];
} {
  if (entries?.ok !== true) return { secrets: [], variables: [] };
  return {
    secrets: entries.value.secrets.filter((entry) => !isOwn(entry)),
    variables: entries.value.variables.filter((entry) => !isOwn(entry)),
  };
}

function entriesError(
  secrets: Listed<SecretList> | null,
  entries: Listed<RepoEntries> | null,
): string | null {
  if (secrets !== null && !secrets.ok) return secrets.error.message;
  if (entries !== null && !entries.ok) return entries.error.message;
  return null;
}

function isOwn(entry: { readonly source: { readonly kind: string } }): boolean {
  return entry.source.kind === 'repository';
}
