import { env } from 'cloudflare:workers';

import { deletionPlan } from '@gitstalk/shared-identity/account-deletion';
import { HANDLE_CHANGE_COOLDOWN_MS, retiredHandles } from '@gitstalk/shared-identity/profiles';

import { AccountSettings } from '../../../components/account/account-settings';
import { DeleteAccountForm, HandleForm } from '../../../components/account/account-forms';
import styles from '../../../components/account/account.module.css';
import { SettingsSection } from '../../../components/settings/settings-shell';
import { formatDate } from '../../../components/account/scope-chips';
import { blockedMessage } from '../../../src/account/account-flows';
import { deletionPorts } from '../../../src/account/account-services';
import { accountPage, queryValue } from '../../../src/server/account-page';

export const metadata = { title: 'Account' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

type PageProps = {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

/** Settings → Account: the handle (with the rules for changing it) and deleting the account. */
export default async function AccountSettingsPage({ searchParams }: PageProps) {
  const { session, profile } = await accountPage('/settings/account');
  const now = Date.now();
  const actor = { id: profile.id, handle: profile.handle, ip: null, now };
  const [retired, facts] = await Promise.all([
    retiredHandles(env, profile.id),
    deletionPorts().facts(actor),
  ]);
  const plan = deletionPlan(facts);
  const nextChange =
    profile.handleChangedAt === null ? null : profile.handleChangedAt + HANDLE_CHANGE_COOLDOWN_MS;
  const isCoolingDown = nextChange !== null && nextChange > now;
  const saved = queryValue(await searchParams, 'saved') === 'handle';
  return (
    <AccountSettings current="account" profile={profile} title="Account">
      <SettingsSection
        id="handle"
        title="Handle"
        lede={
          <>
            You are <b className={styles.mono}>@{profile.handle}</b>, member since{' '}
            {formatDate(profile.createdAt)}.
          </>
        }
      >
        {saved ? (
          <p className={styles.success} role="status">
            Handle changed. Old links and git remotes redirect here.
          </p>
        ) : null}
        <HandleForm
          csrf={session.csrfToken}
          handle={profile.handle}
          isCoolingDown={isCoolingDown}
        />
        {isCoolingDown ? (
          <p className={styles.hint}>You can change it again after {formatDate(nextChange)}.</p>
        ) : null}
        {retired.length === 0 ? null : (
          <p className={styles.hint}>
            Earlier handles, still redirecting to you:{' '}
            {retired.map((handle, index) => (
              <span key={handle}>
                {index === 0 ? '' : ', '}
                <code>@{handle}</code>
              </span>
            ))}
            . Change back to one at any time.
          </p>
        )}
      </SettingsSection>

      <SettingsSection
        id="delete"
        title="Delete account"
        tone="danger"
        lede="This cannot be undone. Your handle becomes free for anyone, and your agents are disconnected at once."
      >
        <ul className={styles.consequences}>
          <li>
            {facts.repositories.length === 0 ? (
              'You own no repositories.'
            ) : (
              <>
                Your{' '}
                {facts.repositories.length === 1
                  ? 'repository'
                  : `${facts.repositories.length} repositories`}{' '}
                {facts.repositories.map((name, index) => (
                  <span key={name}>
                    {index === 0 ? '' : ', '}
                    <code>
                      {profile.handle}/{name}
                    </code>
                  </span>
                ))}{' '}
                {facts.repositories.length === 1 ? 'is' : 'are'} deleted with{' '}
                {facts.repositories.length === 1 ? 'its' : 'their'} history, beans and decisions. To
                keep one, ask a collaborator to clone it first.
              </>
            )}
          </li>
          <li>You leave every repository you were invited to; their owners keep them.</li>
          <li>Passkeys, sessions, personal tokens, SSH keys and your picture are removed.</li>
          <li>
            If you are the only owner of an organisation, add another owner or delete it first.
          </li>
        </ul>
        <DeleteAccountForm
          csrf={session.csrfToken}
          handle={profile.handle}
          blocked={plan.kind === 'blocked' ? blockedMessage(plan) : null}
        />
      </SettingsSection>
    </AccountSettings>
  );
}
