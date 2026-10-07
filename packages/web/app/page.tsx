import { env } from 'cloudflare:workers';

import type { DashboardRepository } from '../components/repository/home-dashboard';
import { HomeDashboard } from '../components/repository/home-dashboard';
import { RunsLanding } from '../components/runs/runs-landing';
import { Invitations } from '../components/repository/invitations';
import { connectedSessions } from '../src/auth/connected-sessions';
import { currentSession } from '../src/auth/user';
import { collaboratorsClient } from '../src/repositories/collaborators-client';
import { growthOf } from '../src/repositories/engine-summary';
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
  const [repositories, sharedRepositories] = await Promise.all([
    withGrowth(listed.ok ? listed.value : []),
    withGrowth(shared.ok ? shared.value : []),
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

/** Each repository with what its engine has grown. */
function withGrowth(records: readonly RepositoryRecord[]): Promise<DashboardRepository[]> {
  return Promise.all(
    records.map(async (record) => ({
      record,
      growth: await growthOf(env.GATEWAY, record.engine_id),
    })),
  );
}
