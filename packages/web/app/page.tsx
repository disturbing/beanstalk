import { env } from 'cloudflare:workers';
import Link from 'next/link';

import { GreensChart } from '../components/race/greens-chart';
import { RunsTable } from '../components/runs/runs-table';
import styles from '../components/runs/runs.module.css';
import { listRuns } from '../src/forge/sources';
import { formatMinutes, formatUsd } from '../src/race/race-format';
import { racePair } from '../src/recorded/race-pair';

export const metadata = { title: 'Runs' };

export default async function RunsPage() {
  const [runs, pair] = await Promise.all([listRuns(env.GATEWAY), Promise.resolve(racePair())]);
  const { left: queue, right: v2 } = pair;
  const until = Math.max(queue.endedAt ?? 0, v2.endedAt ?? 0);
  const speedup =
    queue.wallSeconds !== null && v2.wallSeconds !== null
      ? queue.wallSeconds / v2.wallSeconds
      : null;
  return (
    <main className={styles.page}>
      <section className={styles.hero} aria-labelledby="hero-title">
        <div className={styles.heroText}>
          <h1 id="hero-title" className={styles.heroTitle}>
            Twelve agents, forty beans, one repo.
          </h1>
          <p className={styles.heroLede}>
            The same race twice on Cloudflare: a batched merge queue, then beanstalk v2. v2 finished
            in {v2.wallSeconds === null ? 'n/a' : formatMinutes(v2.wallSeconds)}, the queue in{' '}
            {queue.wallSeconds === null ? 'n/a' : formatMinutes(queue.wallSeconds)}
            {speedup === null ? '' : `: ${speedup.toFixed(1)}× sooner`}, for {formatUsd(v2.costUsd)}{' '}
            against {formatUsd(queue.costUsd)} of agent spend.
          </p>
          <p className={styles.heroActions}>
            <Link href="/race" className={styles.primary}>
              Watch the race
            </Link>
            <Link href={`/runs/${v2.run}`} className={styles.secondary}>
              Explore the v2 repository
            </Link>
          </p>
        </div>
        <div className={styles.heroChart}>
          <GreensChart
            title="Beans on the stalk"
            series={[
              {
                id: 'queue',
                label: queue.label,
                color: 'var(--series-queue)',
                greens: queue.greens,
                endedAt: queue.endedAt,
              },
              {
                id: 'v2',
                label: v2.label,
                color: 'var(--series-v2)',
                greens: v2.greens,
                endedAt: v2.endedAt,
              },
            ]}
            now={until}
            until={until}
            beans={v2.beans}
            marks={[20, 30, 35]}
          />
        </div>
      </section>
      <RunsTable title="Recorded runs" runs={runs.recorded} empty="No recorded runs are bundled." />
      <RunsTable
        title="Live runs"
        runs={runs.live}
        empty={runs.liveError ?? 'The gateway has no runs yet. Start one with the race driver.'}
      />
    </main>
  );
}
