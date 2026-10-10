import { requirePlatformAdmin } from '../../../../src/admin/admin-gate';
import { adminRunPath } from '../../../../src/admin/admin-paths';
import { mayViewEngine } from '../../../../src/repositories/engine-guard';
import { env } from 'cloudflare:workers';
import { notFound } from 'next/navigation';

import { RunId } from '@gitstalk/shared-race/ids';

import type { SearchParams } from '../../../../components/home/repository-home';
import { RepositoryHome, notFoundOr } from '../../../../components/home/repository-home';
import { forgeForRun } from '../../../../src/forge/sources';
import { repositoryOf } from '../../../../src/people/repository';
import { homePageData } from '../../../../src/server/home-page-data';

type PageProps = {
  readonly params: Promise<{ readonly run: string }>;
  readonly searchParams: Promise<SearchParams>;
};

export async function generateMetadata({ params }: PageProps) {
  const parsed = RunId.safeParse((await params).run);
  const repository = parsed.success ? repositoryOf(parsed.data) : null;
  return { title: repository === null ? 'Repository' : `${repository.owner}/${repository.name}` };
}

/** A race's repository: the run's stalk and explorer. */
export default async function RunHome({ params, searchParams }: PageProps) {
  const admin = await requirePlatformAdmin();
  const parsed = RunId.safeParse((await params).run);
  if (!parsed.success) notFound();
  const run = parsed.data;
  if (!(await mayViewEngine(env.GATEWAY, run, admin.id))) notFound();
  // One source per request: a live run's reads are shared by the home and the answer.
  const source = forgeForRun(env.GATEWAY, run);
  const data = await homePageData(source, run).catch(notFoundOr);
  return (
    <RepositoryHome
      frame={{ run, base: adminRunPath(run), repository: repositoryOf(run), kind: 'race' }}
      data={data}
      source={source}
      searchParams={await searchParams}
    />
  );
}
