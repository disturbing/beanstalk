import { RaceDuel } from '../../components/race/race-duel';
import styles from '../../components/race/race-page.module.css';
import type { Speed } from '../../components/canvas/use-replay-clock';
import { racePair } from '../../src/recorded/race-pair';

export const metadata = { title: 'Watch the race' };

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export default async function RacePage({ searchParams }: PageProps) {
  const query = await searchParams;
  const { left, right } = racePair();
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Watch the race</h1>
        <p className={styles.lede}>
          The same 40 colliding tasks, 12 Claude Code agents (Sonnet), the same seed, on Cloudflare:
          a batched, speculative, bisecting merge queue against beanstalk v2. Press play; 10x shows
          the whole race in about four minutes.
        </p>
      </header>
      <RaceDuel
        left={{
          run: left.run,
          label: left.label,
          summary: left.summary,
          color: 'var(--series-queue)',
          events: left.events,
          titles: left.titles,
        }}
        right={{
          run: right.run,
          label: right.label,
          summary: right.summary,
          color: 'var(--series-v2)',
          events: right.events,
          titles: right.titles,
        }}
        initialT={numberParam(query['t']) ?? 0}
        initialSpeed={speedParam(query['speed'])}
      />
    </main>
  );
}

function numberParam(value: string | string[] | undefined): number | null {
  const parsed = Number(typeof value === 'string' ? value : undefined);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function speedParam(value: string | string[] | undefined): Speed {
  if (value === '1') return 1;
  if (value === '60') return 60;
  return 10;
}
