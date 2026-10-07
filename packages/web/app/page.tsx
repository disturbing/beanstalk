import { env } from 'cloudflare:workers';

import type { DashboardRepository } from '../components/repository/home-dashboard';
import { HomeDashboard } from '../components/repository/home-dashboard';
import { RunsLanding } from '../components/runs/runs-landing';
import { Invitations } from '../components/repository/invitations';
import { currentSession } from '../src/auth/user';
import { collaboratorsClient } from '../src/repositories/collaborators-client';
import type { Growth } from '../src/repositories/engine-summary';
import { growthFromIndex, growthOf } from '../src/repositories/engine-summary';
import { indexClient } from '../src/repositories/index-client';
import type { RepositoryRecord } from '../src/repositories/registry-client';
import { registryClient } from '../src/repositories/registry-client';
import { racePair } from '../src/recorded/race-pair';

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/** Signed in: Home (your repositories, recent activity). Signed out: the benchmark landing. */
export default async function Home({ searchParams }: PageProps) {
  const session = await currentSession();
  if (session === null) return <RunsLanding />;
  const { user } = session;
  const registry = registryClient(env.GATEWAY);
  const collaborators = collaboratorsClient(env.GATEWAY);
  const [listed, activity, invitations, shared, query] = await Promise.all([
    registry.list(user.id, user.id),
    registry.activity(user.id, 12),
    collaborators.invitations(user.id),
    collaborators.shared(user.id),
    searchParams,
  ]);
  // Archived repositories leave the default lists (the owner finds them on their page).
  const sharedActive = (shared.ok ? shared.value : []).filter(
    (record) => record.archived_at === null,
  );
  const [repositories, sharedRepositories] = await Promise.all([
    withGrowth(listed.ok ? listed.value : [], user.id),
    withGrowth(sharedActive, user.id),
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
      activity={activity.ok ? activity.value : []}
      nowMs={Date.now()}
      notice={notice}
      demoHref={`/runs/${racePair().right.run}`}
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
 * Each repository with what it has grown: one D1 read for all of them (the repo-events
 * index); a repository the index has not heard from yet asks its engine instead.
 */
async function withGrowth(
  records: readonly RepositoryRecord[],
  viewer: string,
): Promise<DashboardRepository[]> {
  const indexed = await indexClient(env.GATEWAY).growth(
    records.map((record) => record.id),
    viewer,
  );
  const byRepo = new Map((indexed.ok ? indexed.value : []).map((line) => [line.repo_id, line]));
  return Promise.all(
    records.map(async (record) => {
      const line = byRepo.get(record.id);
      const growth: Growth =
        line?.indexed === true
          ? growthFromIndex(line)
          : await growthOf(env.GATEWAY, record.engine_id);
      return { record, growth };
    }),
  );
}
