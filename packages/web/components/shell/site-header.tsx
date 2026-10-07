import Link from 'next/link';

import { currentUser } from '../../src/auth/user';
import { signOut } from '../../src/server/actions';
import { isSignedIn, viewerDay, viewerTheme } from '../../src/server/viewer';
import styles from './shell.module.css';
import { ThemeToggle } from './theme-toggle';
import { VineMark } from './vine-mark';

export async function SiteHeader() {
  const [theme, day, demoGateOpen, user] = await Promise.all([
    viewerTheme(),
    viewerDay(),
    isSignedIn(),
    currentUser(),
  ]);
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand}>
        <VineMark />
        <span className={styles.wordmark}>beanstalk</span>
      </Link>
      <nav aria-label="Site" className={styles.nav}>
        {user === null ? null : <Link href="/">Home</Link>}
        <Link href={user === null ? '/' : '/races'}>Benchmark runs</Link>
        <Link href="/race">Watch the race</Link>
      </nav>
      <div className={styles.tools}>
        {demoGateOpen ? (
          <form action={signOut}>
            <button type="submit" className={styles.textButton}>
              Close demo gate
            </button>
          </form>
        ) : null}
        {user === null ? null : (
          <Link href="/new" className={styles.newRepo}>
            New repository
          </Link>
        )}
        {user === null ? (
          <Link href="/login" className={styles.signIn}>
            Sign in
          </Link>
        ) : (
          <Link href="/settings" className={styles.signIn}>
            @{user.handle}
          </Link>
        )}
        <ThemeToggle initial={theme} day={day} />
      </div>
    </header>
  );
}
