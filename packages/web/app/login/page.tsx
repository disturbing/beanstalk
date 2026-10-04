import Link from 'next/link';

import styles from '../../components/shell/login.module.css';
import { signIn } from '../../src/server/actions';
import { demoPassword, isSignedIn } from '../../src/server/viewer';

export const metadata = { title: 'Sign in to decide' };

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/** The demo gate: one password unlocks the decision buttons on live runs. */
export default async function LoginPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const next = typeof query['next'] === 'string' ? query['next'] : '/';
  const failed = query['error'] !== undefined;
  const configured = demoPassword() !== '';
  const signedIn = await isSignedIn();
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="login-title">
        <h1 id="login-title" className={styles.title}>
          Sign in to decide
        </h1>
        <p className={styles.lede}>
          Reading is open. Answering a decision card changes what a live run ships, so it needs the
          demo password.
        </p>
        {signedIn ? (
          <p className={styles.note}>
            You are signed in. <Link href={next}>Go back</Link>.
          </p>
        ) : null}
        {configured ? (
          <form action={signIn} className={styles.form}>
            <input type="hidden" name="next" value={next} />
            <label htmlFor="password" className={styles.label}>
              Demo password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={styles.input}
              aria-invalid={failed}
              aria-describedby={failed ? 'login-error' : undefined}
            />
            {failed ? (
              <p id="login-error" className={styles.error} role="alert">
                That password is not right. Check it and try again.
              </p>
            ) : null}
            <button type="submit" className={styles.button}>
              Sign in
            </button>
          </form>
        ) : (
          <p className={styles.note}>
            Decisions are off here: set the DEMO_PASSWORD secret (
            <code>wrangler secret put DEMO_PASSWORD</code>, or
            <code> .dev.vars</code> locally) to turn them on.
          </p>
        )}
      </section>
    </main>
  );
}
