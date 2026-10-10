import styles from '../../../components/shell/login.module.css';
import { requirePlatformAdmin } from '../../../src/admin/admin-gate';
import { ADMIN_RUNS } from '../../../src/admin/admin-paths';
import { NextPath } from '../../../src/auth/http';
import { closeDemoGate, openDemoGate } from '../../../src/server/actions';
import { demoPassword, isDemoGateOpen } from '../../../src/server/viewer';

export const metadata = { title: 'Demo gate' };

type Query = Readonly<Record<string, string | string[] | undefined>>;
type PageProps = { readonly searchParams: Promise<Query> };

/**
 * The demo gate: answering a race's decision card changes what a live run ships, so it needs
 * the DEMO_PASSWORD as well as an admin. Opening it sets a signed cookie for twelve hours.
 */
export default async function DemoGatePage({ searchParams }: PageProps) {
  await requirePlatformAdmin();
  const query = await searchParams;
  const next = NextPath.parse(typeof query['next'] === 'string' ? query['next'] : ADMIN_RUNS);
  return (
    <main className={styles.page}>
      <section className={styles.panel} aria-labelledby="demo-title">
        <h1 id="demo-title" className={styles.title}>
          Demo gate
        </h1>
        <p className={styles.lede}>
          Answering a decision card changes what a live run ships, so it needs the demo password.
        </p>
        <GateForm next={next} failed={query['error'] !== undefined} />
      </section>
    </main>
  );
}

async function GateForm({ next, failed }: { readonly next: string; readonly failed: boolean }) {
  if (demoPassword() === '')
    return <p className={styles.note}>Decisions are off here: no DEMO_PASSWORD is set.</p>;
  if (await isDemoGateOpen())
    return (
      <form action={closeDemoGate} className={styles.form}>
        <p className={styles.note}>The demo gate is open in this browser.</p>
        <button type="submit" className={styles.button}>
          Close the demo gate
        </button>
      </form>
    );
  return (
    <form action={openDemoGate} className={styles.form}>
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
        aria-describedby={failed ? 'gate-error' : undefined}
      />
      {failed ? (
        <p id="gate-error" className={styles.error} role="alert">
          That password is not right. Check it and try again.
        </p>
      ) : null}
      <button type="submit" className={styles.button}>
        Open the demo gate
      </button>
    </form>
  );
}
