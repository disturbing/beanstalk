import Link from 'next/link';

import styles from '../components/shell/login.module.css';

export default function NotFound() {
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="missing-title">
        <h1 id="missing-title" className={styles.title}>
          Nothing grows here
        </h1>
        <p className={styles.lede}>This page does not exist, or it is not shared with you.</p>
        <p>
          <Link href="/">Back home</Link>
        </p>
      </section>
    </main>
  );
}
