import { env } from 'cloudflare:workers';

import type { DashboardRepository } from '../components/repository/home-dashboard';
import { HomeDashboard } from '../components/repository/home-dashboard';
import { RunsLanding } from '../components/runs/runs-landing';
import { currentUser } from '../src/auth/user';
import { growthFromCounts, growthOf } from '../src/repositories/engine-summary';
import { activityLines, readEngineFeeds } from '../src/repositories/home-activity';
import { registryClient } from '../src/repositories/registry-client';
import { racePair } from '../src/recorded/race-pair';

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/** Signed in: Home (your repositories, recent activity). Signed out: the benchmark landing. */
export default async function Home({ searchParams }: PageProps) {
  const user = await currentUser();
  if (user === null) return <RunsLanding />;
  const registry = registryClient(env.GATEWAY);
  const [listed, activity, query] = await Promise.all([
    registry.list(user.id, user.id),
    registry.activity(user.id, 12),
    searchParams,
  ]);
  const records = listed.ok ? listed.value : [];
  // One call for every repository's counts and recent engine events.
  const feeds = await readEngineFeeds(
    env.GATEWAY,
    records.map((record) => record.engine_id),
  );
  const repositories: DashboardRepository[] = await Promise.all(
    records.map(async (record) => {
      const feed = feeds.get(record.engine_id);
      // An older gateway without engine feeds: one summary per repository, as before.
      const growth =
        feed === undefined
          ? await growthOf(env.GATEWAY, record.engine_id)
          : growthFromCounts(feed.tasks);
      return { record, growth };
    }),
  );
  const deleted = typeof query['deleted'] === 'string' ? query['deleted'] : null;
  const notice = noticeOf(listed.ok ? null : listed.error.message, deleted);
  return (
    <HomeDashboard
      user={user}
      repositories={repositories}
      activity={activityLines({
        records,
        registry: activity.ok ? activity.value : [],
        feeds,
        limit: 14,
      })}
      nowMs={Date.now()}
      notice={notice}
      demoHref={`/runs/${racePair().right.run}`}
    />
  );
}

function noticeOf(
  listError: string | null,
  deleted: string | null,
): { readonly tone: 'good' | 'warn'; readonly text: string } | null {
  if (listError !== null)
    return { tone: 'warn', text: `Your repositories could not be listed: ${listError}` };
  return deleted === null ? null : { tone: 'good', text: `Deleted ${deleted}.` };
}
