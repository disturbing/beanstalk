import { env } from 'cloudflare:workers';
import { currentUser } from '../../../../src/auth/user';
import { mayViewEngine } from '../../../../src/repositories/engine-guard';
import { notFound } from 'next/navigation';

import { RunId } from '@gitstalk/shared-race/ids';

import { FilesExplorer } from '../../../../components/explorer/files-explorer';
import type { SearchParams } from '../../../../components/home/repository-home';
import { repositoryOf } from '../../../../src/people/repository';

type PageProps = {
  readonly params: Promise<{ readonly run: string }>;
  readonly searchParams: Promise<SearchParams>;
};

export async function generateMetadata({ params }: PageProps) {
  const { run } = await params;
  return { title: `Files, race-${run}` };
}

export default async function RunFilesPage({ params, searchParams }: PageProps) {
  const parsed = RunId.safeParse((await params).run);
  if (!parsed.success) notFound();
  const run = parsed.data;
  if (!(await mayViewEngine(env.GATEWAY, run, (await currentUser())?.id ?? null))) notFound();
  return (
    <FilesExplorer
      frame={{ run, base: `/runs/${run}`, repository: repositoryOf(run), kind: 'race' }}
      searchParams={await searchParams}
    />
  );
}
