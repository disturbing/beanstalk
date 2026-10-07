import { env } from 'cloudflare:workers';

import type { DashboardRepository } from '../components/repository/home-dashboard';
import { HomeDashboard } from '../components/repository/home-dashboard';
import { RunsLanding } from '../components/runs/runs-landing';
import { currentUser } from '../src/accounts/current-user';
import { growthOf } from '../src/repositories/engine-summary';
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
  const repositories: DashboardRepository[] = await Promise.all(
    records.map(async (record) => ({
      record,
      growth: await growthOf(env.GATEWAY, record.engine_id),
    })),
  );
  const deleted = typeof query['deleted'] === 'string' ? query['deleted'] : null;
  const notice = noticeOf(listed.ok ? null : listed.error.message, deleted);
  return (
    <HomeDashboard
      user={user}
      repositories={repositories}
      activity={activity.ok ? activity.value : []}
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
