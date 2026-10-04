import Link from 'next/link';

import styles from '../components/shell/login.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="missing-title">
        <h1 id="missing-title" className={styles.title}>
          Nothing grows here
        </h1>
        <p className={styles.lede}>
          This run, bean or page does not exist. It may have been reaped after its race.
        </p>
        <p>
          <Link href="/">Back to the runs</Link>
        </p>
      </section>
    </main>
  );
}
