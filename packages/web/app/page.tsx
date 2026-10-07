import { env } from 'cloudflare:workers';

import type { DashboardRepository } from '../components/repository/home-dashboard';
import { HomeDashboard } from '../components/repository/home-dashboard';
import { RunsLanding } from '../components/runs/runs-landing';
import { Invitations } from '../components/repository/invitations';
import { connectedSessions } from '../src/auth/connected-sessions';
import { currentSession } from '../src/auth/user';
import { collaboratorsClient } from '../src/repositories/collaborators-client';
import type { Growth } from '../src/repositories/engine-summary';
import { growthFromCounts, growthFromIndex, growthOf } from '../src/repositories/engine-summary';
import type { ActivityLine, Feed } from '../src/repositories/home-activity';
import { activityLines, indexLines, readEngineFeeds } from '../src/repositories/home-activity';
import type { RepositoryGrowth } from '../src/repositories/index-client';
import { indexClient } from '../src/repositories/index-client';
import type { RepositoryActivity, RepositoryRecord } from '../src/repositories/registry-client';
import { registryClient } from '../src/repositories/registry-client';
import { racePair } from '../src/recorded/race-pair';

/** Lines in Home's activity. */
const HOME_LINES = 14;

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
  const [listed, archived, activity, invitations, shared, sessions, query] = await Promise.all([
    registry.list(user.id, user.id),
    registry.list(user.id, user.id, 'archived'),
    registry.activity(user.id, 40),
    collaborators.invitations(user.id),
    collaborators.shared(user.id),
    connectedSessions(user.id),
    searchParams,
  ]);
  // Archived repositories leave the default lists (the owner finds them on their page).
  const own = listed.ok ? listed.value : [];
  const others = (shared.ok ? shared.value : []).filter((record) => record.archived_at === null);
  // One D1 read for every repository's counts (repo-events); only repositories the index has
  // not heard from yet are asked through the engines' feeds.
  const indexed = await indexClient(env.GATEWAY).growth(
    [...own, ...others].map((record) => record.id),
    user.id,
  );
  const growthByRepo = new Map(
    (indexed.ok ? indexed.value : [])
      .filter((line) => line.indexed)
      .map((line) => [line.repo_id, line]),
  );
  const unindexed = [...own, ...others].filter((record) => !growthByRepo.has(record.id));
  const feeds = await readEngineFeeds(
    env.GATEWAY,
    unindexed.map((record) => record.engine_id),
  );
  const [repositories, sharedRepositories] = await Promise.all([
    withGrowth(own, { growthByRepo, feeds }),
    withGrowth(others, { growthByRepo, feeds }),
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
      activity={homeActivity({
        unindexed,
        registry: activity.ok ? activity.value : [],
        feeds,
      })}
      archivedCount={archived.ok ? archived.value.length : 0}
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
 * Each repository with what it has grown: from the index, else its engine's feed, else (an
 * older gateway) its engine's view.
 */
function withGrowth(
  records: readonly RepositoryRecord[],
  known: {
    readonly growthByRepo: ReadonlyMap<string, RepositoryGrowth>;
    readonly feeds: ReadonlyMap<string, Feed>;
  },
): Promise<DashboardRepository[]> {
  return Promise.all(
    records.map(async (record) => {
      const line = known.growthByRepo.get(record.id);
      const feed = known.feeds.get(record.engine_id);
      let growth: Growth;
      if (line !== undefined) growth = growthFromIndex(line);
      else if (feed !== undefined) growth = growthFromCounts(feed.tasks);
      else growth = await growthOf(env.GATEWAY, record.engine_id);
      return { record, growth };
    }),
  );
}

/** The index's lines (registry and engines), plus feed lines for repositories not indexed yet. */
function homeActivity(input: {
  readonly unindexed: readonly RepositoryRecord[];
  readonly registry: readonly RepositoryActivity[];
  readonly feeds: ReadonlyMap<string, Feed>;
}): readonly ActivityLine[] {
  const fromFeeds = activityLines({
    records: input.unindexed,
    registry: [],
    feeds: input.feeds,
    limit: HOME_LINES,
  });
  return [...indexLines(input.registry), ...fromFeeds]
    .toSorted((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, HOME_LINES);
}
