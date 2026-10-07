import { env } from 'cloudflare:workers';
import { redirect } from 'next/navigation';

import type { SshKeySummary } from '@beanstalk/shared-identity/ssh-keys';
import { listSshKeys } from '@beanstalk/shared-identity/ssh-keys';

import styles from '../../../components/account/account.module.css';
import { formatDate } from '../../../components/account/scope-chips';
import { SettingsTabs } from '../../../components/account/settings-tabs';
import { currentSession } from '../../../src/auth/user';

export const metadata = { title: 'SSH keys' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

const NOTES: Readonly<Record<string, string>> = {
  added: 'Key added.',
  removed:
    'Key removed. It no longer opens your repositories, and the HTTPS token setup gave that machine is revoked.',
};

/** Settings → SSH keys: the public keys git over SSH accepts for this person. */
export default async function SshKeysPage({ searchParams }: PageProps) {
  const session = await currentSession();
  if (session === null) redirect('/login?next=/settings/keys');
  const query = await searchParams;
  const keys = await listSshKeys(env, session.user.id);
  const note = typeof query['note'] === 'string' ? NOTES[query['note']] : undefined;
  const error = typeof query['error'] === 'string' ? query['error'].slice(0, 200) : undefined;
  return (
    <main className={styles.page}>
      <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="keys-title">
        <h1 id="keys-title" className={styles.title}>
          @{session.user.handle}
        </h1>
        <SettingsTabs current="keys" />
        <section className={styles.section} aria-labelledby="list-title">
          <h2 id="list-title" className={styles.sectionTitle}>
            SSH keys
          </h2>
          <p className={styles.note}>
            The easy way to add one: in Claude Code, run <code>/beanstalk:setup</code>. It finds
            your keys (1Password, ssh-agent, <code>~/.ssh</code>) or makes one, and sends you here
            to approve it. Only public keys are stored.
          </p>
          {note === undefined ? null : (
            <p className={styles.success} role="status">
              {note}
            </p>
          )}
          {error === undefined ? null : (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          {keys.length === 0 ? (
            <p className={styles.empty}>No SSH keys yet.</p>
          ) : (
            <KeyTable keys={keys} csrf={session.csrfToken} />
          )}
        </section>
        <section className={styles.section} aria-labelledby="paste-title">
          <h2 id="paste-title" className={styles.sectionTitle}>
            Add a key by hand
          </h2>
          <form method="post" action="/settings/keys/paste" className={styles.tokenForm}>
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <div className={styles.field}>
              <label htmlFor="key-name" className={styles.label}>
                Name
              </label>
              <input
                id="key-name"
                name="name"
                className={styles.input}
                placeholder="laptop"
                maxLength={60}
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="key-line" className={styles.label}>
                Public key (the one line in <code>~/.ssh/id_ed25519.pub</code>)
              </label>
              <textarea
                id="key-line"
                name="public_key"
                className={`${styles.input} ${styles.mono}`}
                rows={3}
                required
                placeholder="ssh-ed25519 AAAA… you@laptop"
              />
            </div>
            <button type="submit" className={styles.primary}>
              Add key
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}

function KeyTable({
  keys,
  csrf,
}: {
  readonly keys: readonly SshKeySummary[];
  readonly csrf: string;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Fingerprint</th>
          <th scope="col">Added</th>
          <th scope="col">Last used</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {keys.map((key) => (
          <tr key={key.id}>
            <td>
              {key.name}
              <br />
              <span className={styles.muted}>{key.keyType}</span>
            </td>
            <td className={styles.mono}>{key.fingerprint}</td>
            <td className={styles.muted}>{formatDate(key.createdAt)}</td>
            <td className={styles.muted}>{formatDate(key.lastUsedAt)}</td>
            <td>
              <form method="post" action="/settings/keys/remove">
                <input type="hidden" name="csrf" value={csrf} />
                <input type="hidden" name="key" value={key.id} />
                <button type="submit" className={styles.danger} aria-label={`Remove ${key.name}`}>
                  Remove
                </button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
