import { env } from 'cloudflare:workers';

import { RunId } from '@beanstalk/shared-race/ids';

import type { SearchParams } from '../../../components/home/repository-home';
import { RepositoryHome } from '../../../components/home/repository-home';
import { RepoHead } from '../../../components/home/repo-head';
import { StartHere } from '../../../components/repository/start-here';
import { currentSession } from '../../../src/auth/user';
import { forgeForRun } from '../../../src/forge/sources';
import { hasGrown } from '../../../src/repositories/flows';
import { startGuide } from '../../../src/repositories/paths';
import { pushersOf } from '../../../src/repositories/pushers';
import { registryClient } from '../../../src/repositories/registry-client';
import type { HomePageData } from '../../../src/server/home-page-data';
import { homePageData } from '../../../src/server/home-page-data';
import type { RepositoryParams } from '../../../src/server/repository-page';
import { repositoryPage, startConfig } from '../../../src/server/repository-page';

type PageProps = {
  readonly params: RepositoryParams;
  readonly searchParams: Promise<SearchParams>;
};

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo } = await params;
  return { title: `${decodeURIComponent(owner)}/${decodeURIComponent(repo)}` };
}

/**
 * A repository: until its first bean starts, the start page (how a person or an agent
 * begins); after that, the same home as a race's repository, read from its engine.
 */
export default async function RepositoryPage({ params, searchParams }: PageProps) {
  const page = await repositoryPage(params);
  const { record, base } = page;
  const engine = RunId.safeParse(record.engine_id);
  const source = engine.success ? forgeForRun(env.GATEWAY, engine.data) : null;
  const data =
    source === null || !engine.success
      ? null
      : await Promise.all([
          homePageData(source, engine.data, record.owner.handle),
          pushersOf(env.GATEWAY, engine.data),
        ]).then(
          ([home, pushers]): HomePageData => ({ ...home, pushers }),
          (): HomePageData | null => null,
        );
  const frame = {
    base,
    repository: { owner: record.owner.handle, name: record.name },
    kind: 'repository' as const,
    visibility: record.visibility,
    ownerHref: `/${record.owner.handle}`,
  };
  if (data !== null && source !== null && engine.success && hasGrown(data.events)) {
    return (
      <RepositoryHome
        frame={{ ...frame, run: engine.data }}
        data={data}
        source={source}
        searchParams={await searchParams}
      />
    );
  }
  const [files, config, session] = await Promise.all([
    registryClient(env.GATEWAY).files(record.id, page.user?.id ?? null),
    startConfig(),
    page.isOwner ? currentSession() : Promise.resolve(null),
  ]);
  return (
    <main>
      <RepoHead {...frame} current="code" />
      <StartHere
        record={record}
        files={files.ok ? files.value : null}
        guide={startGuide(config, record.owner.handle, record.name)}
        deploy={
          session === null ? null : { repoId: record.id, csrf: session.csrfToken, path: base }
        }
      />
    </main>
  );
}
