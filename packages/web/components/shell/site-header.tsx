import { env } from 'cloudflare:workers';
import Link from 'next/link';

import { getProfile } from '@beanstalk/shared-identity/profiles';
import { orgsOf } from '@beanstalk/shared-identity/orgs';

import { Avatar } from '../account/avatar';

import { currentUser } from '../../src/auth/user';
import menu from '../orgs/orgs.module.css';
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
  const [profile, orgs] =
    user === null
      ? [null, []]
      : await Promise.all([getProfile(env, user.id), orgsOf(env, user.id)]);
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
          <details className={menu.menu}>
            <summary className={styles.me}>
              <Avatar
                seed={user.id}
                label={
                  profile === null || profile.displayName === '' ? user.handle : profile.displayName
                }
                imageKey={profile?.avatarKey ?? null}
                size={22}
              />
              @{user.handle}
            </summary>
            <ul className={menu.menuList}>
              <li>
                <Link href={`/${user.handle}`}>Your repositories</Link>
              </li>
              {orgs.map(({ org }) => (
                <li key={org.id}>
                  <Link href={`/${org.handle}`}>{org.name}</Link>
                </li>
              ))}
              <li>
                <Link href="/orgs/new">New organization</Link>
              </li>
              <li className={menu.menuRule} role="separator" />
              <li>
                <Link href="/settings">Account settings</Link>
              </li>
            </ul>
          </details>
        )}
        <ThemeToggle initial={theme} day={day} />
      </div>
    </header>
  );
}
