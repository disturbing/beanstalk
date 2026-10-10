import { env } from 'cloudflare:workers';

import type { SshKeySummary } from '@gitstalk/shared-identity/ssh-keys';
import { listSshKeys } from '@gitstalk/shared-identity/ssh-keys';

import styles from '../../../components/account/account.module.css';
import { formatDate } from '../../../components/account/scope-chips';
import { AccountSettings } from '../../../components/account/account-settings';
import { SettingsSection } from '../../../components/settings/settings-shell';
import { accountPage } from '../../../src/server/account-page';
import type { SshEndpoint } from '../../../src/repositories/paths';
import { sshEndpoint } from '../../../src/repositories/paths';

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
  const { session, profile } = await accountPage('/settings/keys');
  const query = await searchParams;
  const keys = await listSshKeys(env, session.user.id);
  const note = typeof query['note'] === 'string' ? NOTES[query['note']] : undefined;
  const error = typeof query['error'] === 'string' ? query['error'].slice(0, 200) : undefined;
  return (
    <AccountSettings
      current="keys"
      profile={profile}
      title="SSH keys"
      lede={
        <>
          The easy way to add one: in Claude Code, run <code>/beanstalk:setup</code>. It finds your
          keys (1Password, ssh-agent, <code>~/.ssh</code>) or makes one, and sends you here to
          approve it. Only public keys are stored.
        </>
      }
    >
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
      <SettingsSection id="list" title="Your keys">
        {keys.length === 0 ? (
          <p className={styles.empty}>No SSH keys yet.</p>
        ) : (
          <KeyTable keys={keys} csrf={session.csrfToken} />
        )}
      </SettingsSection>
      <ServerKey endpoint={sshEndpoint(env)} />
      <SettingsSection id="paste" title="Add a key by hand">
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
          <div className={styles.inline}>
            <button type="submit" className={styles.primary}>
              Add key
            </button>
          </div>
        </form>
      </SettingsSection>
    </AccountSettings>
  );
}

/** The server's host key, so a person can check what `ssh` shows on first connect. */
function ServerKey({ endpoint }: { readonly endpoint: SshEndpoint | undefined }) {
  if (endpoint === undefined || endpoint.hostKeyFingerprint === '') return null;
  return (
    <SettingsSection id="host-key" title="Beanstalk’s host key">
      <p className={styles.note}>
        The first time you connect to <code>{endpoint.host}</code>, <code>ssh</code> shows the
        server&apos;s key fingerprint. Continue only if it matches:
      </p>
      <dl className={styles.facts}>
        <dt>Host</dt>
        <dd className={styles.mono}>{endpoint.host}</dd>
        <dt>Fingerprint</dt>
        <dd className={styles.mono}>{endpoint.hostKeyFingerprint}</dd>
      </dl>
    </SettingsSection>
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
