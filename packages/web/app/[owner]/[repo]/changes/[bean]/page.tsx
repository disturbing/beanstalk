import { notFound, redirect } from 'next/navigation';

import { ChangeDetail } from '../../../../../components/repo-tabs/change-detail';
import { changesOf } from '../../../../../src/changes/changes';
import { repositoryTab } from '../../../../../src/server/repository-tab';

type PageProps = {
  readonly params: Promise<{
    readonly owner: string;
    readonly repo: string;
    readonly bean: string;
  }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo, bean } = await params;
  return {
    title: `${decodeURIComponent(bean)}, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}`,
  };
}

/** One bean's page: its journey, its verdict and its diff. */
export default async function ChangePage({ params }: PageProps) {
  const resolved = await params;
  const tab = await repositoryTab(Promise.resolve(resolved));
  if (tab.reads === null) redirect(tab.base);
  const name = decodeURIComponent(resolved.bean);
  const [events, pushed, diff] = await Promise.all([
    tab.reads.events(),
    tab.reads.pushed(),
    tab.reads.beanDiff(name).catch(() => null),
  ]);
  const changes = changesOf(events, pushed);
  const change = changes.find((candidate) => candidate.bean === name);
  if (change === undefined) notFound();
  return (
    <ChangeDetail
      tab={tab}
      change={change}
      changes={changes}
      verdict={pushed.find((bean) => bean.bean === name)?.verdict ?? []}
      diff={diff}
      lastSeq={events.at(-1)?.seq ?? 0}
      nowMs={Date.now()}
    />
  );
}
