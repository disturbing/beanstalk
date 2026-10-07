import { redirect } from 'next/navigation';

import { ChangesTab, shownGroup } from '../../../../components/repo-tabs/changes-tab';
import type { SearchParams } from '../../../../components/home/repository-home';
import { changesOf } from '../../../../src/changes/changes';
import type { RepositoryParams } from '../../../../src/server/repository-page';
import { repositoryTab } from '../../../../src/server/repository-tab';

type PageProps = {
  readonly params: RepositoryParams;
  readonly searchParams: Promise<SearchParams>;
};

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo } = await params;
  return { title: `Changes, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}` };
}

/** The repository's beans: open, landed, parked. Two gateway reads, however many beans. */
export default async function ChangesPage({ params, searchParams }: PageProps) {
  const [tab, query] = await Promise.all([repositoryTab(params), searchParams]);
  if (tab.reads === null) redirect(tab.base);
  const [events, pushed] = await Promise.all([tab.reads.events(), tab.reads.pushed()]);
  const changes = changesOf(events, pushed);
  return (
    <ChangesTab
      tab={tab}
      changes={changes}
      show={shownGroup(query['show'], changes)}
      lastSeq={events.at(-1)?.seq ?? 0}
      nowMs={Date.now()}
    />
  );
}
