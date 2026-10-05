import Link from 'next/link';

import { isSignedIn, viewerDay, viewerTheme } from '../../src/server/viewer';
import { signOut } from '../../src/server/actions';
import styles from './shell.module.css';
import { ThemeToggle } from './theme-toggle';
import { VineMark } from './vine-mark';

export async function SiteHeader() {
  const [theme, day, signedIn] = await Promise.all([viewerTheme(), viewerDay(), isSignedIn()]);
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <VineMark />
        <span className={styles.wordmark}>beanstalk</span>
      </Link>
      <nav aria-label="Site" className={styles.nav}>
        <Link href="/">Benchmark runs</Link>
        <Link href="/race">Watch the race</Link>
      </nav>
      <div className={styles.tools}>
        {signedIn ? (
          <form action={signOut}>
            <button type="submit" className={styles.textButton}>
              Sign out
            </button>
          </form>
        ) : (
          <Link href="/login" className={styles.signIn}>
            Sign in to decide
          </Link>
        )}
        <ThemeToggle initial={theme} day={day} />
      </div>
    </header>
  );
}
