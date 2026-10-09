import { env } from 'cloudflare:workers';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { imageUrl } from '@beanstalk/shared-media/images';

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
import type { SettingsNavItem } from '../../../../components/settings/settings-shell';
import {
  SettingsSection,
  SettingsShell,
  SoonPill,
} from '../../../../components/settings/settings-shell';
import shell from '../../../../components/settings/settings-shell.module.css';
import { PictureSection } from '../../../../components/settings/picture-section';
import { pictureNote } from '../../../../src/account/picture-notes';
import type {
  RepoEntries,
  SecretList,
  SecretSummary,
} from '../../../../src/actions/actions-contract';
import { actionsSession } from '../../../../src/server/actions-source';
import { queryValue } from '../../../../src/server/account-page';
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
 * Settings, in the settings shell: a left nav of this page's sections. Everyone with a role
 * sees the default branch and the effective checks (read from the stalk's
 * `.beanstalk/checks.toml`; changed by a maintainer's bean, never here). The owner has all of
 * it; a maintainer has deploy tokens and Actions secrets (when Actions run here); other
 * collaborators are told whose settings these are; people with no role get the same 404 as a
 * missing repository. The gateway checks every change again.
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
  const isArchived = record.archived_at !== null;
  const actions = await actionsSession({ actor, repoId: record.id });
  const [tokens, people, files, secrets, entries, orgTargets] = await Promise.all([
    canDeploy ? deployTokensClient(env.GATEWAY).list(actor, record.id) : Promise.resolve(null),
    isOwner ? collaboratorsClient(env.GATEWAY).people(record.id, actor.id) : Promise.resolve(null),
    registryClient(env.GATEWAY).files(record.id, actor.id),
    actions === null || !canDeploy ? Promise.resolve(null) : actions.client.secrets(),
    actions === null ? Promise.resolve(null) : actions.client.entries(),
    isOwner ? transferTargets(actor.id) : Promise.resolve([]),
  ]);
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
    website: record.website,
    topics: record.topics,
  };
  const query = await searchParams;
  const savedParam = queryValue(query, 'saved');
  const saved = savedParam === 'renamed' ? `Renamed to ${record.name}.` : null;
  const archiveSaved = ARCHIVE_SAVED[String(savedParam)] ?? null;
  const canEdit = isOwner && !isArchived;
  const showsSecrets = actions !== null;
  const actionsAccess =
    canDeploy && !isArchived
      ? { csrf: session.csrfToken, owner: record.owner.handle, name: record.name }
      : null;
  const showsTokens = tokens !== null && !isArchived;
  const nav: SettingsNavItem[] = [
    ...(canEdit
      ? [
          { href: '#general', label: 'General' },
          { href: '#social', label: 'Social image' },
          { href: '#visibility', label: 'Visibility' },
        ]
      : []),
    { href: '#branches', label: 'Branches' },
    { href: '#checks', label: 'Checks' },
    ...(canEdit ? [{ href: '#features', label: 'Features' }] : []),
    ...(isOwner ? [{ href: '#collaborators', label: 'Collaborators' }] : []),
    ...(showsSecrets ? [{ href: '#actions', label: 'Secrets and variables' }] : []),
    ...(showsTokens ? [{ href: '#deploy-tokens', label: 'Deploy tokens' }] : []),
    ...(isOwner
      ? [
          { href: '#archive', label: isArchived ? 'Unarchive' : 'Archive' },
          { href: '#transfer', label: 'Transfer' },
          { href: '#danger', label: 'Delete', isDanger: true },
        ]
      : []),
  ];
  const who = (
    <div className={shell.who}>
      <span className={shell.whoText}>
        <span className={shell.whoName}>{record.name}</span>
        <span className={shell.whoSub}>
          {record.owner.handle}/{record.name} · {isArchived ? 'archived' : record.visibility}
        </span>
      </span>
    </div>
  );
  return (
    <>
      <RepoHead
        base={base}
        repository={{ owner: record.owner.handle, name: record.name }}
        current="settings"
        kind="repository"
        visibility={record.visibility}
        ownerHref={`/${record.owner.handle}`}
        archived={isArchived}
      />
      <SettingsShell
        who={who}
        nav={[{ title: 'Repository', items: nav }]}
        title="Settings"
        lede={
          isOwner ? undefined : (
            <>
              You are <b>{role}</b> on {record.name}. Its name, visibility, people and deletion are{' '}
              <b>@{record.owner.handle}</b>&rsquo;s
              {record.owner_kind === 'org' ? ' (its owners and admins)' : ''}.{' '}
              {canDeploy && !isArchived ? 'As a maintainer you manage its deploy tokens. ' : null}
              <Link href={`${base}/people`}>See who has access</Link>.
            </>
          )
        }
      >
        {isOwner && isArchived ? (
          <div id="archive" className={styles.anchor}>
            <ArchiveSettings repo={repo} archivedAt={record.archived_at} saved={archiveSaved} />
          </div>
        ) : null}
        {canEdit ? (
          <div id="general" className={styles.anchor}>
            <GeneralSettings repo={repo} saved={saved} />
          </div>
        ) : null}
        {canEdit ? (
          <PictureSection
            id="social"
            title="Social image"
            lede="Shown when a link to this repository is shared. 1280 × 640 works best; PNG, JPEG, WebP or GIF up to 2 MB."
            action={`${base}/settings/social-image`}
            csrf={session.csrfToken}
            hasPicture={record.social_image_key !== null}
            note={pictureNote(queryValue(query, 'picture'))}
            removeLabel="Remove social image"
            current={
              record.social_image_key === null ? (
                <div className={styles.socialEmpty}>
                  No social image: previews show the name and description.
                </div>
              ) : (
                <img
                  className={styles.socialPreview}
                  src={imageUrl(record.social_image_key, 640)}
                  alt="The current social image"
                  width={420}
                  height={210}
                />
              )
            }
          />
        ) : null}
        {canEdit ? (
          <div id="visibility" className={styles.anchor}>
            <VisibilitySettings repo={repo} />
          </div>
        ) : null}
        <SettingsSection
          id="branches"
          title="Branches"
          lede="Beans land on the sprout; the stalk is what passed validation on the merged tree. People and agents push bean/* branches only."
        >
          <dl className={styles.branchFacts}>
            <dt>Default branch</dt>
            <dd className={styles.mono}>{record.default_branch}</dd>
            <dt>Landing line</dt>
            <dd className={styles.mono}>sprout</dd>
            <dt>Pushable</dt>
            <dd className={styles.mono}>bean/*</dd>
          </dl>
          <p className={styles.hint}>
            The default branch is fixed to the stalk: clones check it out, and nobody pushes to it.
          </p>
        </SettingsSection>
        <SettingsSection
          id="checks"
          title="Checks"
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
        {canEdit ? <Features /> : null}
        {isOwner && people !== null && people.ok ? (
          <div id="collaborators" className={styles.anchor}>
            <CollaboratorsSettings
              name={record.name}
              collaborators={people.value.collaborators}
              invitations={people.value.invitations}
              audit={people.value.audit}
              access={access}
            />
          </div>
        ) : null}
        {actions !== null ? (
          <SettingsSection id="actions" title="Secrets and variables">
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
          </SettingsSection>
        ) : null}
        {showsTokens ? (
          <div id="deploy-tokens" className={styles.anchor}>
            <DeployTokens tokens={tokens.ok ? tokens.value : []} access={access} />
          </div>
        ) : null}
        {canEdit ? (
          <div id="archive" className={styles.anchor}>
            <ArchiveSettings repo={repo} archivedAt={null} saved={archiveSaved} />
          </div>
        ) : null}
        {isOwner ? (
          <div id="transfer" className={styles.anchor}>
            <TransferRepository
              repoId={record.id}
              fullName={`${record.owner.handle}/${record.name}`}
              targets={targets}
              csrf={session.csrfToken}
            />
          </div>
        ) : null}
        {isOwner ? (
          <div id="danger" className={styles.anchor}>
            <DangerZone repo={repo} />
          </div>
        ) : null}
      </SettingsShell>
    </>
  );
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
      lede="Every repository has the same features today. Switches arrive with organisations."
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
