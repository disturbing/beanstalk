import { redirect } from 'next/navigation';

import { HistoryTab } from '../../../../components/repo-tabs/history-tab';
import { changesOf } from '../../../../src/changes/changes';
import { historyOf, landingsOf } from '../../../../src/history/history';
import type { RepositoryParams } from '../../../../src/server/repository-page';
import { repositoryTab } from '../../../../src/server/repository-tab';

type PageProps = { readonly params: RepositoryParams };

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo } = await params;
  return { title: `History, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}` };
}

/** The stalk's commits, and the sprout's not validated yet. Four reads, all at once. */
export default async function HistoryPage({ params }: PageProps) {
  const tab = await repositoryTab(params);
  if (tab.reads === null) redirect(tab.base);
  const [stalk, sprout, pushed, events] = await Promise.all([
    tab.reads.log('stalk'),
    tab.reads.log('sprout'),
    tab.reads.pushed(),
    tab.reads.events(),
  ]);
  const history = historyOf({ stalk, sprout, pushed, landings: landingsOf(events) });
  return (
    <HistoryTab
      tab={tab}
      history={history}
      changes={changesOf(events, pushed)}
      nowMs={Date.now()}
    />
  );
}
