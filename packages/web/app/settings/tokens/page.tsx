import { env } from 'cloudflare:workers';
import { redirect } from 'next/navigation';

import type { TokenSummary } from '@beanstalk/shared-identity/user-tokens';
import { listUserTokens } from '@beanstalk/shared-identity/user-tokens';

import styles from '../../../components/account/account.module.css';
import { CreateTokenForm } from '../../../components/account/create-token-form';
import { ScopeChips, formatDate } from '../../../components/account/scope-chips';
import { SettingsTabs } from '../../../components/account/settings-tabs';
import { currentSession } from '../../../src/auth/user';

export const metadata = { title: 'Tokens' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

/** Personal access tokens (bsu_) and the session tokens agents minted (bss_): create, list, revoke. */
export default async function TokensPage() {
  const session = await currentSession();
  if (session === null) redirect('/login?next=/settings/tokens');
  const tokens = await listUserTokens(env, session.user.id);
  const now = Date.now();
  return (
    <main className={styles.page}>
      <section className={`${styles.panel} ${styles.wide}`} aria-labelledby="tokens-title">
        <h1 id="tokens-title" className={styles.title}>
          @{session.user.handle}
        </h1>
        <SettingsTabs current="tokens" />
        <section className={styles.section} aria-labelledby="new-title">
          <h2 id="new-title" className={styles.sectionTitle}>
            New personal access token
          </h2>
          <p className={styles.note}>
            For git over HTTPS and for MCP clients without OAuth. Scoped, expiring, revocable;
            stored only as a hash.
          </p>
          <CreateTokenForm csrf={session.csrfToken} />
        </section>
        <section className={styles.section} aria-labelledby="list-title">
          <h2 id="list-title" className={styles.sectionTitle}>
            Your tokens
          </h2>
          {tokens.length === 0 ? (
            <p className={styles.empty}>No tokens yet.</p>
          ) : (
            <TokenTable tokens={tokens} csrf={session.csrfToken} now={now} />
          )}
        </section>
      </section>
    </main>
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
