import { notFound } from 'next/navigation';

import type { OrgParams } from '../../../../src/server/org-settings';
import { orgSettings } from '../../../../src/server/org-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

/**
 * `/orgs/<org>/settings`: lands on the first section this member may open (General for owners
 * and admins, Secrets and variables for everyone else); old anchors survive the redirect.
 */
export default async function OrgSettingsLanding({ params }: { readonly params: OrgParams }) {
  await orgSettings(params, 'landing');
  notFound();
}
