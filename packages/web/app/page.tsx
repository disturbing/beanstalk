import { env } from 'cloudflare:workers';

import type { DashboardRepository } from '../components/repository/home-dashboard';
import { HomeDashboard } from '../components/repository/home-dashboard';
import { RunsLanding } from '../components/runs/runs-landing';
import { Invitations } from '../components/repository/invitations';
import { connectedSessions } from '../src/auth/connected-sessions';
import { currentSession } from '../src/auth/user';
import { collaboratorsClient } from '../src/repositories/collaborators-client';
import { growthFromCounts, growthOf } from '../src/repositories/engine-summary';
import type { Feed } from '../src/repositories/home-activity';
import { activityLines, readEngineFeeds } from '../src/repositories/home-activity';
import type { RepositoryRecord } from '../src/repositories/registry-client';
import { registryClient } from '../src/repositories/registry-client';
import { racePair } from '../src/recorded/race-pair';

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/**
 * Signed in: Home (first steps, your repositories and the demo, your sessions, recent
 * activity). Signed out: the benchmark landing.
 */
export default async function Home({ searchParams }: PageProps) {
  const session = await currentSession();
  if (session === null) return <RunsLanding />;
  const { user } = session;
  const registry = registryClient(env.GATEWAY);
  const collaborators = collaboratorsClient(env.GATEWAY);
  const [listed, activity, invitations, shared, sessions, query] = await Promise.all([
    registry.list(user.id, user.id),
    registry.activity(user.id, 12),
    collaborators.invitations(user.id),
    collaborators.shared(user.id),
    connectedSessions(user.id),
    searchParams,
  ]);
  const own = listed.ok ? listed.value : [];
  const others = shared.ok ? shared.value : [];
  // One call for every repository's counts and recent engine events (own and shared).
  const feeds = await readEngineFeeds(
    env.GATEWAY,
    [...own, ...others].map((record) => record.engine_id),
  );
  const [repositories, sharedRepositories] = await Promise.all([
    withGrowth(own, feeds),
    withGrowth(others, feeds),
  ]);
  const notice = noticeOf(listed.ok ? null : listed.error.message, {
    deleted: stringParam(query['deleted']),
    left: stringParam(query['left']),
  });
  return (
    <HomeDashboard
      user={user}
      repositories={repositories}
      shared={sharedRepositories}
      invitations={
        <Invitations
          invitations={invitations.ok ? invitations.value : []}
          csrf={session.csrfToken}
        />
      }
      activity={activityLines({
        records: [...own, ...others],
        registry: activity.ok ? activity.value : [],
        feeds,
        limit: 14,
      })}
      nowMs={Date.now()}
      notice={notice}
      demoHref={`/runs/${racePair().right.run}`}
      sessions={sessions}
    />
  );
}

function noticeOf(
  listError: string | null,
  done: { readonly deleted: string | null; readonly left: string | null },
): { readonly tone: 'good' | 'warn'; readonly text: string } | null {
  if (listError !== null)
    return { tone: 'warn', text: `Your repositories could not be listed: ${listError}` };
  if (done.left !== null) return { tone: 'good', text: `You left ${done.left}.` };
  return done.deleted === null ? null : { tone: 'good', text: `Deleted ${done.deleted}.` };
}

function stringParam(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

/**
 * Each repository with what its engine has grown, from the engine feeds; an older gateway
 * without engine feeds is asked once per repository, as before.
 */
function withGrowth(
  records: readonly RepositoryRecord[],
  feeds: ReadonlyMap<string, Feed>,
): Promise<DashboardRepository[]> {
  return Promise.all(
    records.map(async (record) => {
      const feed = feeds.get(record.engine_id);
      const growth =
        feed === undefined
          ? await growthOf(env.GATEWAY, record.engine_id)
          : growthFromCounts(feed.tasks);
      return { record, growth };
    }),
  );
}
