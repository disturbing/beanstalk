import { env } from 'cloudflare:workers';

import type { TokenSummary } from '@beanstalk/shared-identity/user-tokens';
import { listUserTokens } from '@beanstalk/shared-identity/user-tokens';

import styles from '../../../components/account/account.module.css';
import { CreateTokenForm } from '../../../components/account/create-token-form';
import { ScopeChips, formatDate } from '../../../components/account/scope-chips';
import { AccountSettings } from '../../../components/account/account-settings';
import { SettingsSection } from '../../../components/settings/settings-shell';
import { accountPage } from '../../../src/server/account-page';

export const metadata = { title: 'Tokens' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

/** Personal access tokens (bsu_) and the session tokens agents minted (bss_): create, list, revoke. */
export default async function TokensPage() {
  const { session, profile } = await accountPage('/settings/tokens');
  const tokens = await listUserTokens(env, session.user.id);
  const now = Date.now();
  return (
    <AccountSettings
      current="tokens"
      profile={profile}
      title="Tokens"
      lede="For git over HTTPS and for MCP clients without OAuth. Scoped, expiring, revocable; stored only as a hash."
    >
      <SettingsSection id="new" title="New personal access token">
        <CreateTokenForm csrf={session.csrfToken} />
      </SettingsSection>
      <SettingsSection
        id="list"
        title="Your tokens"
        lede="Personal tokens you made, and the short-lived ones your agents minted for git."
      >
        {tokens.length === 0 ? (
          <p className={styles.empty}>No tokens yet.</p>
        ) : (
          <TokenTable tokens={tokens} csrf={session.csrfToken} now={now} />
        )}
      </SettingsSection>
    </AccountSettings>
  );
}

function TokenTable({
  tokens,
  csrf,
  now,
}: {
  readonly tokens: readonly TokenSummary[];
  readonly csrf: string;
  readonly now: number;
}) {
  return (
    <table className={styles.table}>
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Token</th>
          <th scope="col">Scopes</th>
          <th scope="col">Expires</th>
          <th scope="col">Last used</th>
          <th scope="col">
            <span className="visually-hidden">Actions</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {tokens.map((token) => {
          const state = tokenState(token, now);
          return (
            <tr key={token.id}>
              <td>
                {token.name}
                {token.kind === 'session' ? (
                  <span className={styles.muted}> · agent session</span>
                ) : null}
              </td>
              <td className={styles.mono}>{token.hint}</td>
              <td>
                <ScopeChips scopes={token.scopes} />
              </td>
              <td className={styles.muted}>
                {state === 'live' ? formatDate(token.expiresAt) : state}
              </td>
              <td className={styles.muted}>{formatDate(token.lastUsedAt)}</td>
              <td>
                {state === 'live' ? (
                  <form method="post" action="/settings/tokens/revoke">
                    <input type="hidden" name="csrf" value={csrf} />
                    <input type="hidden" name="token" value={token.id} />
                    <button
                      type="submit"
                      className={styles.danger}
                      aria-label={`Revoke ${token.name}`}
                    >
                      Revoke
                    </button>
                  </form>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function tokenState(token: TokenSummary, now: number): 'live' | 'revoked' | 'expired' {
  if (token.revokedAt !== null) return 'revoked';
  return token.expiresAt <= now ? 'expired' : 'live';
}
