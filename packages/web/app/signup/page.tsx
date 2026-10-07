import Link from 'next/link';

import styles from '../../components/account/account.module.css';
import { TurnstileField } from '../../components/account/turnstile';
import { PasskeySignup } from '../../components/account/passkey-buttons';
import { NextPath } from '../../src/auth/http';
import { emailSignIn } from '../../src/auth/services';
import { turnstileSiteKey } from '../../src/auth/turnstile';
import { currentUser } from '../../src/auth/user';

export const metadata = { title: 'Sign up' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

type Query = Readonly<Record<string, string | string[] | undefined>>;
type PageProps = { readonly searchParams: Promise<Query> };

/** Sign-up: a handle and a passkey. Email sign-up appears only once a sender domain is set. */
export default async function SignupPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const next = NextPath.parse(typeof query['next'] === 'string' ? query['next'] : '/');
  const user = await currentUser();
  const email = emailSignIn() !== null;
  const siteKey = turnstileSiteKey();
  const connecting = next.startsWith('/connect');
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="signup-title">
        <p className={styles.eyebrow}>
          {connecting ? 'connect an agent · create your account' : 'beanstalk'}
        </p>
        <h1 id="signup-title" className={styles.title}>
          Create your account
        </h1>
        <p className={styles.lede}>
          Pick a handle and save a passkey on this device. No password and no email: your agents
          connect to this account over MCP, and you approve each one.
        </p>
        {user === null ? (
          <PasskeySignup next={next} turnstileSiteKey={siteKey} />
        ) : (
          <p className={styles.success}>
            You are signed in as <strong>@{user.handle}</strong>. <Link href={next}>Continue</Link>.
          </p>
        )}
        {email && user === null ? <EmailSignup query={query} siteKey={siteKey} /> : null}
        <p className={styles.note}>
          Already have an account?{' '}
          <Link href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link>
        </p>
      </section>
    </main>
  );
}

function EmailSignup({
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
      <p className={styles.divider}>or with email</p>
      <form method="post" action="/api/auth/email" className={styles.form}>
        <label htmlFor="signup-email" className={styles.label}>
          Email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={styles.input}
        />
        <label htmlFor="signup-email-handle" className={styles.label}>
          Handle
        </label>
        <input
          id="signup-email-handle"
          name="handle"
          required
          className={styles.input}
          autoCapitalize="none"
        />
        <TurnstileField siteKey={siteKey} action="signup" />
        <button type="submit" className={styles.secondary}>
          Email me a sign-up link
        </button>
        {query['email_error'] === undefined ? null : (
          <p className={styles.error} role="alert">
            Check the address and handle, and try again in a minute.
          </p>
        )}
      </form>
    </>
  );
}
