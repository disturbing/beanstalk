import { env } from 'cloudflare:workers';
import { redirect } from 'next/navigation';

import type { AgentSession } from '@beanstalk/shared-identity/agent-sessions';
import { listPasskeys } from '@beanstalk/shared-identity/passkeys';

import styles from '../../components/account/account.module.css';
import { AddPasskey } from '../../components/account/passkey-buttons';
import { ScopeChips, formatDate } from '../../components/account/scope-chips';
import { SettingsTabs } from '../../components/account/settings-tabs';
import { connectedSessions } from '../../src/auth/connected-sessions';
import { emailSignIn } from '../../src/auth/services';
import { currentSession } from '../../src/auth/user';

export const metadata = { title: 'Settings' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

const PASSKEY_NOTES: Readonly<Record<string, string>> = {
  removed: 'Passkey removed.',
  last_sign_in_method: 'That is your only way to sign in, so it stays. Add another passkey first.',
  not_found: 'That passkey was already gone.',
};

/** The signed-in person: profile, passkeys, connected agents, and signing out everywhere. */
export default async function SettingsPage({ searchParams }: PageProps) {
  const session = await currentSession();
  if (session === null) redirect('/login?next=/settings');
  const query = await searchParams;
  const { user, csrfToken } = session;
  const [passkeys, agents] = await Promise.all([
    listPasskeys(env, user.id),
    connectedSessions(user.id),
  ]);
  const passkeyNote =
    typeof query['passkey'] === 'string' ? PASSKEY_NOTES[query['passkey']] : undefined;
  return (
    <main className={styles.page}>
      <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="settings-title">
        <h1 id="settings-title" className={styles.title}>
          @{user.handle}
        </h1>
        <SettingsTabs current="account" />

        <section className={styles.section} aria-labelledby="profile-title">
          <h2 id="profile-title" className={styles.sectionTitle}>
            Profile
          </h2>
          <dl className={styles.facts}>
            <dt>Handle</dt>
            <dd>@{user.handle}</dd>
            <dt>Email</dt>
            <dd>
              {user.email ??
                (emailSignIn() === null ? 'none (email sign-in is not on yet)' : 'none')}
            </dd>
          </dl>
        </section>

        <section className={styles.section} aria-labelledby="passkeys-title">
          <h2 id="passkeys-title" className={styles.sectionTitle}>
            Passkeys
          </h2>
          {passkeyNote === undefined ? null : (
            <p className={styles.note} role="status">
              {passkeyNote}
            </p>
          )}
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Added</th>
                <th scope="col">Last used</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {passkeys.map((passkey) => (
                <tr key={passkey.id}>
                  <td>{passkey.name}</td>
                  <td className={styles.muted}>{formatDate(passkey.createdAt)}</td>
                  <td className={styles.muted}>{formatDate(passkey.lastUsedAt)}</td>
                  <td>
                    <form method="post" action="/settings/passkeys/remove">
                      <input type="hidden" name="csrf" value={csrfToken} />
                      <input type="hidden" name="passkey" value={passkey.id} />
                      <button
                        type="submit"
                        className={styles.danger}
                        aria-label={`Remove ${passkey.name}`}
                      >
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <AddPasskey csrf={csrfToken} />
        </section>

        <section className={styles.section} aria-labelledby="agents-title">
          <h2 id="agents-title" className={styles.sectionTitle}>
            Connected agents
          </h2>
          {agents === null ? (
            <p className={styles.empty}>
              Connected agents could not be loaded. Reload to try again.
            </p>
          ) : (
            <AgentList agents={agents} csrf={csrfToken} mcpUrl={env.MCP_URL} />
          )}
          <p className={styles.hint}>
            A connection made in the last minute shows as “connecting” until it can be disconnected
            here.
          </p>
        </section>

        <section className={styles.section} aria-labelledby="sessions-title">
          <h2 id="sessions-title" className={styles.sectionTitle}>
            Sign out
          </h2>
          <div className={styles.inline}>
            <form method="post" action="/auth/signout">
              <input type="hidden" name="csrf" value={csrfToken} />
              <button type="submit" className={styles.secondary}>
                Sign out
              </button>
            </form>
            <form method="post" action="/auth/signout">
              <input type="hidden" name="csrf" value={csrfToken} />
              <input type="hidden" name="everywhere" value="1" />
              <button type="submit" className={styles.danger}>
                Sign out everywhere
              </button>
            </form>
          </div>
        </section>
      </section>
    </main>
  );
}

function AgentList({
  agents,
  csrf,
  mcpUrl,
}: {
  readonly agents: readonly AgentSession[];
  readonly csrf: string;
  readonly mcpUrl: string;
}) {
  if (agents.length === 0)
    return (
      <p className={styles.empty}>
        No agents yet. <a href="/signup/agent">Connect one</a>: one command for Claude Code or
        Codex. Any other MCP client: add <code>{mcpUrl}</code> and sign in when it asks.
      </p>
    );
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Agent</th>
          <th scope="col">Scopes</th>
          <th scope="col">Connected</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {agents.map((agent) => (
          <tr key={agent.grantId}>
            <td>{agent.clientName}</td>
            <td>
              <ScopeChips scopes={agent.scopes} />
            </td>
            <td className={styles.muted}>{formatDate(agent.createdAt)}</td>
            <td>
              {agent.settling === true ? (
                <span className={styles.muted}>connecting…</span>
              ) : (
                <form method="post" action="/settings/sessions/revoke">
                  <input type="hidden" name="csrf" value={csrf} />
                  <input type="hidden" name="grant" value={agent.grantId} />
                  <button
                    type="submit"
                    className={styles.danger}
                    aria-label={`Disconnect ${agent.clientName}`}
                  >
                    Disconnect
                  </button>
                </form>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
