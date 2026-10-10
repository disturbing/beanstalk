import { RunsLanding } from '../../../components/runs/runs-landing';
import { requirePlatformAdmin } from '../../../src/admin/admin-gate';

export const metadata = { title: 'Benchmark runs' };

/** The benchmark runs: the race in one chart, then recorded and live runs (admins only). */
export default async function AdminRunsPage() {
  await requirePlatformAdmin();
  return <RunsLanding />;
}
