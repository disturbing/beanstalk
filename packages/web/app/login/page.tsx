import Link from 'next/link';

import styles from '../../components/account/account.module.css';
import { TurnstileField } from '../../components/account/turnstile';
import { PasskeySignin } from '../../components/account/passkey-buttons';
import loginStyles from '../../components/shell/login.module.css';
import { NextPath } from '../../src/auth/http';
import { emailSignIn } from '../../src/auth/services';
import { turnstileSiteKey } from '../../src/auth/turnstile';
import { currentUser } from '../../src/auth/user';
import { signIn } from '../../src/server/actions';
import { demoPassword, isSignedIn } from '../../src/server/viewer';

export const metadata = { title: 'Sign in' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

type Query = Readonly<Record<string, string | string[] | undefined>>;
type PageProps = { readonly searchParams: Promise<Query> };

/**
 * Sign in with a passkey (and by email once a sender domain is configured). The demo gate for
 * decision cards (DEMO_PASSWORD) stays below until decisions move to repository roles.
 */
export default async function LoginPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const next = NextPath.parse(typeof query['next'] === 'string' ? query['next'] : '/');
  const user = await currentUser();
  const email = emailSignIn() !== null;
  const siteKey = turnstileSiteKey();
  return (
    <main className={styles.page}>
      <div className={styles.stack}>
        <section className={styles.panel} aria-labelledby="login-title">
          {next.startsWith('/connect') ? (
            <p className={styles.eyebrow}>connect an agent · sign in</p>
          ) : null}
          <h1 id="login-title" className={styles.title}>
            Sign in to Beanstalk
          </h1>
          {user === null ? (
            <>
              <PasskeySignin next={next} turnstileSiteKey={siteKey} />
              {email ? <EmailSignin query={query} siteKey={siteKey} /> : null}
              <p className={styles.note}>
                New here?{' '}
                <Link href={`/signup?next=${encodeURIComponent(next)}`}>Create an account</Link>
              </p>
            </>
          ) : (
            <p className={styles.success}>
              Signed in as <strong>@{user.handle}</strong>. <Link href={next}>Continue</Link> or
              open <Link href="/settings">Settings</Link>.
            </p>
          )}
        </section>
        <DemoGate query={query} next={next} />
      </div>
    </main>
  );
}

function EmailSignin({
  query,
  siteKey,
}: {
  readonly query: Query;
  readonly siteKey: string | null;
}) {
  if (query['email_sent'] !== undefined)
    return (
      <p className={styles.success}>
        Check your email: the link works once, for 15 minutes, in this browser.
      </p>
    );
  return (
    <>
      <p className={styles.divider}>or</p>
      <form method="post" action="/api/auth/email" className={styles.form}>
        <label htmlFor="login-email" className={styles.label}>
          Email
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={styles.input}
        />
        <TurnstileField siteKey={siteKey} action="signin" />
        <button type="submit" className={styles.secondary}>
          Email me a sign-in link
        </button>
        {query['email_error'] === undefined ? null : (
          <p className={styles.error} role="alert">
            That link did not work, or too many tries. Ask for a new one.
          </p>
        )}
      </form>
    </>
  );
}

/** The demo password for decision cards on live runs (unchanged). */
async function DemoGate({ query, next }: { readonly query: Query; readonly next: string }) {
  if (demoPassword() === '') return null;
  const signedIn = await isSignedIn();
  const failed = query['error'] !== undefined;
  return (
    <section className={loginStyles.panel} aria-labelledby="demo-title">
      <h2 id="demo-title" className={styles.sectionTitle}>
        Decide on live runs
      </h2>
      <p className={loginStyles.lede}>
        Answering a decision card changes what a live run ships, so it needs the demo password.
      </p>
      {signedIn ? <p className={loginStyles.note}>The demo gate is open in this browser.</p> : null}
      <form action={signIn} className={loginStyles.form}>
        <input type="hidden" name="next" value={next} />
        <label htmlFor="password" className={loginStyles.label}>
          Demo password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={loginStyles.input}
          aria-invalid={failed}
          aria-describedby={failed ? 'login-error' : undefined}
        />
        {failed ? (
          <p id="login-error" className={loginStyles.error} role="alert">
            That password is not right. Check it and try again.
          </p>
        ) : null}
        <button type="submit" className={loginStyles.button}>
          Open the demo gate
        </button>
      </form>
    </section>
  );
}
