import { redirect } from 'next/navigation';

import { AskTab } from '../../../../components/repo-tabs/ask-tab';
import type { SearchParams } from '../../../../components/home/repository-home';
import type { RepositoryParams } from '../../../../src/server/repository-page';
import { repositoryPage } from '../../../../src/server/repository-page';

type PageProps = {
  readonly params: RepositoryParams;
  readonly searchParams: Promise<SearchParams>;
};

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo } = await params;
  return { title: `Ask, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}` };
}

/** Ask: the generated explorer over the engine; before anything grew, the start page. */
export default async function AskPage({ params, searchParams }: PageProps) {
  const [page, query] = await Promise.all([repositoryPage(params), searchParams]);
  const ask = await AskTab({ page, searchParams: query });
  if (ask === null) redirect(page.base);
  return ask;
}
