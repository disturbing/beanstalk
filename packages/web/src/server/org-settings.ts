/**
 * The start of every `/orgs/<org>/settings/<section>` page: the signed-in session (or sign in
 * and come back), the org and the viewer's role in it (the 404 page for people outside it, the
 * same as a missing org), and a section this role may open (otherwise the first one it may).
 * Owners and admins manage; every member reads the secrets list and may leave. Server-only.
 */
import { notFound, redirect } from 'next/navigation';

import type { OrgRole } from '@gitstalk/shared-identity/orgs';
import type { WebSession } from '@gitstalk/shared-identity/sessions';

import { currentSession } from '../auth/user';
import type { OrgPage } from '../orgs/org-page';
import { orgPage } from '../orgs/org-page';
import type { OrgSection } from '../settings/sections';
import { firstOrgSection, orgSections, orgSettingsPath } from '../settings/sections';

export type OrgParams = Promise<{ readonly org: string }>;

export type OrgSettings = OrgPage & {
  readonly role: OrgRole;
  readonly session: WebSession;
  /** Owner or admin. */
  readonly manages: boolean;
  /** This section's path, for revalidation after a save. */
  readonly path: string;
};

export async function orgSettings(
  params: OrgParams,
  section: OrgSection | 'landing',
): Promise<OrgSettings> {
  const handle = decodeURIComponent((await params).org);
  const session = await currentSession();
  if (session === null) {
    const here = section === 'landing' ? '' : `/${section}`;
    redirect(
      `/login?next=${encodeURIComponent(`/orgs/${encodeURIComponent(handle)}/settings${here}`)}`,
    );
  }
  const page = await orgPage(handle, session.user.id);
  if (page === null || page.role === null) notFound();
  const { role } = page;
  if (!orgSections(role).some((link) => link.slug === section))
    redirect(orgSettingsPath(page.org.handle, firstOrgSection(role)));
  return {
    ...page,
    role,
    session,
    manages: role === 'owner' || role === 'admin',
    path: orgSettingsPath(page.org.handle, section === 'landing' ? 'general' : section),
  };
}

/** A settings page's `generateMetadata`: "<Section> · <org> settings". */
export function orgSettingsMetadata(label: string) {
  return async ({ params }: { readonly params: OrgParams }) => ({
    title: `${label} · ${decodeURIComponent((await params).org)} settings`,
  });
}
