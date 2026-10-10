import { env } from 'cloudflare:workers';

import type { AgentSession } from '@gitstalk/shared-identity/agent-sessions';
import type { BrowserSession } from '@gitstalk/shared-identity/sessions';
import { listBrowserSessions } from '@gitstalk/shared-identity/sessions';

import { AccountSettings } from '../../../components/account/account-settings';
import styles from '../../../components/account/account.module.css';
import { ScopeChips, formatDate } from '../../../components/account/scope-chips';
import { SettingsSection } from '../../../components/settings/settings-shell';
import { connectedSessions } from '../../../src/auth/connected-sessions';
import { browserLabel } from '../../../src/account/browser-label';
import { accountPage, queryValue } from '../../../src/server/account-page';

export const metadata = { title: 'Sessions and agents' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

const NOTES: Readonly<Record<string, string>> = {
  disconnected: 'Agent disconnected: its tokens stopped working.',
  browser: 'That browser is signed out.',
  gone: 'That browser had already signed out.',
};

/** Settings → Sessions and agents: browsers signed in, agents connected, signing out. */
export default async function SessionSettingsPage({ searchParams }: PageProps) {
  const { session, profile } = await accountPage('/settings/sessions');
  const [browsers, agents] = await Promise.all([
    listBrowserSessions(env, session, Date.now()),
    connectedSessions(profile.id),
  ]);
  const note = noteFor(await searchParams);
  return (
    <AccountSettings
      current="sessions"
      profile={profile}
      title="Sessions and agents"
      lede="Every browser signed in as you, and every agent you connected over MCP. Ending one takes effect at once."
    >
      {note === undefined ? null : (
        <p className={styles.success} role="status">
          {note}
        </p>
      )}
      <SettingsSection
        id="agents"
        title="Connected agents"
        lede="Agents act as you within the scopes you approved; disconnecting revokes their tokens and the git credentials they minted."
      >
        {agents === null ? (
          <p className={styles.empty}>Connected agents could not be loaded. Reload to try again.</p>
        ) : (
          <AgentList agents={agents} csrf={session.csrfToken} mcpUrl={env.MCP_URL} />
        )}
        <p className={styles.hint}>
          A connection made in the last minute shows as “connecting” until it can be disconnected
          here.
        </p>
      </SettingsSection>
      <SettingsSection id="browsers" title="Browsers">
        <BrowserList browsers={browsers} csrf={session.csrfToken} />
      </SettingsSection>
      <SettingsSection id="sign-out" title="Sign out">
        <div className={styles.inline}>
          <form method="post" action="/auth/signout">
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <button type="submit" className={styles.secondary}>
              Sign out here
            </button>
          </form>
          <form method="post" action="/auth/signout">
            <input type="hidden" name="csrf" value={session.csrfToken} />
            <input type="hidden" name="everywhere" value="1" />
            <button type="submit" className={styles.danger}>
              Sign out everywhere
            </button>
          </form>
        </div>
      </SettingsSection>
    </AccountSettings>
  );
}

/** The line after a sign-out or a disconnect (`?signed_out=`, `?disconnected=`). */
function noteFor(
  query: Readonly<Record<string, string | string[] | undefined>>,
): string | undefined {
  const signedOut = queryValue(query, 'signed_out');
  if (signedOut !== undefined) return NOTES[signedOut];
  return queryValue(query, 'disconnected') === undefined ? undefined : NOTES['disconnected'];
}

function BrowserList({
  browsers,
  csrf,
}: {
  readonly browsers: readonly BrowserSession[];
  readonly csrf: string;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Browser</th>
          <th scope="col">Signed in</th>
          <th scope="col">Last active</th>
          <th scope="col">
            <span className="visually-hidden">Sign out</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {browsers.map((browser) => (
          <tr key={browser.id}>
            <td>
              {browserLabel(browser.userAgent)}{' '}
              {browser.isCurrent ? <span className={styles.current}>this browser</span> : null}
            </td>
            <td className={styles.muted}>{formatDate(browser.createdAt)}</td>
            <td className={styles.muted}>{formatDate(browser.lastSeenAt)}</td>
            <td>
              {browser.isCurrent ? null : (
                <form method="post" action="/settings/sessions/browser">
                  <input type="hidden" name="csrf" value={csrf} />
                  <input type="hidden" name="browser" value={browser.id} />
                  <button
                    type="submit"
                    className={styles.danger}
                    aria-label={`Sign out ${browserLabel(browser.userAgent)}`}
                  >
                    Sign out
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
            <span className="visually-hidden">Disconnect</span>
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
