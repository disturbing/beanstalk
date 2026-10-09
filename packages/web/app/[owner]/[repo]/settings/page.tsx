import { notFound } from 'next/navigation';

import type { RepositoryParams } from '../../../../src/server/repository-page';
import { repositorySettings } from '../../../../src/server/repository-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

/**
 * `/<owner>/<repo>/settings`: lands on the first section this viewer may open (General for the
 * owner). The browser keeps an old anchor (`#social`) across the redirect, and the section page
 * moves it to its own page.
 */
export default async function RepositorySettingsLanding({
  params,
}: {
  readonly params: RepositoryParams;
}) {
  await repositorySettings(params, 'landing');
  notFound();
}
