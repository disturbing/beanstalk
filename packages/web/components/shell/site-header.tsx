import { env } from 'cloudflare:workers';
import Link from 'next/link';

import { getProfile } from '@beanstalk/shared-identity/profiles';

import { Avatar } from '../account/avatar';

import { currentSession } from '../../src/auth/user';
import { signOut } from '../../src/server/actions';
import { isSignedIn, viewerTheme } from '../../src/server/viewer';
import { NEW_MENU, primaryLinks, userMenu } from '../../src/shell/header-entries';
import { HeaderMenu } from './header-menu';
import styles from './header.module.css';
import { ThemeToggle } from './theme-toggle';
import { VineMark } from './vine-mark';

/**
 * The app header on every page. Left: the mark (Home) and the primary links. Right, signed in:
 * the New menu and the person's menu (profile, repositories, organizations, settings, connect
 * an agent, docs, day or night, sign out). Signed out: the theme pair, Sign in and Sign up.
 */
export async function SiteHeader() {
  const [theme, demoGateOpen, session] = await Promise.all([
    viewerTheme(),
    isSignedIn(),
    currentSession(),
  ]);
  const user = session?.user ?? null;
  const profile = user === null ? null : await getProfile(env, user.id);
  return (
    <header className={styles.header}>
      <Link href="/" className={styles.brand} aria-label="beanstalk home">
        <VineMark />
        <span className={styles.wordmark}>beanstalk</span>
      </Link>
      <nav aria-label="Primary" className={styles.nav}>
        <ul className={styles.navList}>
          {primaryLinks(user?.handle ?? null).map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={styles.navLink}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.tools}>
        {demoGateOpen ? (
          <form action={signOut}>
            <button type="submit" className={styles.textButton}>
              Close demo gate
            </button>
          </form>
        ) : null}
        {session === null || user === null ? (
          <>
            <ThemeToggle initial={theme} />
            <Link href="/login" className={styles.signIn}>
              Sign in
            </Link>
            <Link href="/signup" className={styles.signUp}>
              Sign up
            </Link>
          </>
        ) : (
          <>
            <HeaderMenu
              label="Create new"
              variant="accent"
              button={
                <>
                  <span aria-hidden="true" className={styles.plus}>
                    +
                  </span>
                  <span className={styles.newText}>New</span>
                  <span aria-hidden="true" className={styles.caret} />
                </>
              }
              entries={NEW_MENU}
            />
            <HeaderMenu
              label={`Account menu for @${user.handle}`}
              button={
                <>
                  <Avatar
                    seed={user.id}
                    label={
                      profile === null || profile.displayName === ''
                        ? user.handle
                        : profile.displayName
                    }
                    imageKey={profile?.avatarKey ?? null}
                    size={26}
                  />
                  <span aria-hidden="true" className={styles.caret} />
                </>
              }
              entries={userMenu({
                handle: user.handle,
                csrf: session.csrfToken,
                theme,
                docsUrl: env.DOCS_URL,
              })}
            />
          </>
        )}
      </div>
    </header>
  );
}
