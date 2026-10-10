/**
 * The start of every `/<owner>/<repo>/settings/<section>` page: the repository (404 for people
 * with no role, the same as a missing one), the signed-in session, the facts that decide the
 * sections, and the Actions client when Actions run here. A section this viewer may not open
 * sends them to the first one they may. Server-only.
 */
import { notFound, redirect } from 'next/navigation';

import type { WebSession } from '@gitstalk/shared-identity/sessions';

import { currentSession } from '../auth/user';
import type { RepositoryRecord, ViewerRole } from '../repositories/registry-client';
import type { RepoSection, RepoSettingsFacts } from '../settings/sections';
import { firstRepoSection, repoSections, repoSettingsPath } from '../settings/sections';
import type { ActionsSession } from './actions-source';
import { actionsSession } from './actions-source';
import type { RepositoryParams } from './repository-page';
import { repositoryPage } from './repository-page';

export type RepositorySettings = {
  readonly record: RepositoryRecord;
  readonly base: string;
  readonly role: ViewerRole;
  readonly session: WebSession;
  readonly actor: { readonly id: string; readonly handle: string };
  readonly facts: RepoSettingsFacts;
  readonly actions: ActionsSession | null;
  readonly isOwner: boolean;
  /** Owner or maintainer. */
  readonly maintains: boolean;
  readonly isArchived: boolean;
};

/** A settings page's `generateMetadata`: "<Section> · <owner>/<repo> settings". */
export function settingsMetadata(label: string) {
  return async ({ params }: { readonly params: RepositoryParams }) => {
    const { owner, repo } = await params;
    return {
      title: `${label} · ${decodeURIComponent(owner)}/${decodeURIComponent(repo)} settings`,
    };
  };
}

export type SettingsQuery = Promise<Readonly<Record<string, string | string[] | undefined>>>;

export async function repositorySettings(
  params: RepositoryParams,
  section: RepoSection | 'landing',
): Promise<RepositorySettings> {
  const { record, base, role } = await repositoryPage(params);
  if (role === null) notFound();
  const session = await currentSession();
  if (session === null) notFound();
  const actor = { id: session.user.id, handle: session.user.handle };
  const actions = await actionsSession({ actor, repoId: record.id });
  const isArchived = record.archived_at !== null;
  const facts: RepoSettingsFacts = { role, isArchived, hasActions: actions !== null };
  const allowed = repoSections(facts).some((link) => link.slug === section);
  if (!allowed) redirect(repoSettingsPath(base, firstRepoSection(facts)));
  return {
    record,
    base,
    role,
    session,
    actor,
    facts,
    actions,
    isOwner: role === 'owner',
    maintains: role === 'owner' || role === 'maintain',
    isArchived,
  };
}
