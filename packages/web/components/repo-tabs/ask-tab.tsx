/**
 * The Ask tab: the generated explorer over the repository's engine (the stalk, Growing now,
 * What happened, and answers to questions), the same home a race's repository has. Its links
 * carry `?q=` and `?bean=` on the repository's root, which also opens here.
 */
import { env } from 'cloudflare:workers';

import { RunId } from '@gitstalk/shared-race/ids';

import type { SearchParams } from '../home/repository-home';
import { RepositoryHome } from '../home/repository-home';
import { forgeForRun } from '../../src/forge/sources';
import { hasGrown } from '../../src/repositories/flows';
import { pushersOf } from '../../src/repositories/pushers';
import type { HomePageData } from '../../src/server/home-page-data';
import { homePageData } from '../../src/server/home-page-data';
import type { RepositoryPage } from '../../src/server/repository-page';

/** Query keys that belong to the Ask view rather than the Code tab. */
const ASK_KEYS = ['q', 'bean', 't', 'removed'] as const;

export function isAskQuery(query: SearchParams): boolean {
  return ASK_KEYS.some((key) => query[key] !== undefined);
}

/** The Ask view, or null when the engine has nothing to show yet (the caller shows the start). */
export async function AskTab(props: {
  readonly page: RepositoryPage;
  readonly searchParams: SearchParams;
}) {
  const { record, base } = props.page;
  const engine = RunId.safeParse(record.engine_id);
  if (!engine.success) return null;
  const source = forgeForRun(env.GATEWAY, engine.data);
  const data = await Promise.all([
    homePageData(source, engine.data, record.owner.handle),
    pushersOf(env.GATEWAY, engine.data),
  ]).then(
    ([home, pushers]): HomePageData => ({ ...home, pushers }),
    (): HomePageData | null => null,
  );
  if (data === null || !hasGrown(data.events)) return null;
  return (
    <RepositoryHome
      frame={{
        run: engine.data,
        base,
        repository: { owner: record.owner.handle, name: record.name },
        kind: 'repository',
        visibility: record.visibility,
        ownerHref: `/${record.owner.handle}`,
      }}
      data={data}
      source={source}
      searchParams={props.searchParams}
    />
  );
}
