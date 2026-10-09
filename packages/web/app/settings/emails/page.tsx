import { env } from 'cloudflare:workers';

import { AccountSettings } from '../../../components/account/account-settings';
import styles from '../../../components/account/account.module.css';
import { SettingsSection, SoonPill } from '../../../components/settings/settings-shell';
import { emailSignIn } from '../../../src/auth/services';
import { accountPage } from '../../../src/server/account-page';

export const metadata = { title: 'Emails' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

/**
 * Settings → Emails: display only. Adding and verifying addresses needs mail to go out, which
 * waits for the sender domain (docs/claude-opus/19 §6).
 */
export default async function EmailSettingsPage() {
  const { session, profile } = await accountPage('/settings/emails');
  const isMailOn = emailSignIn() !== null;
  const email = session.user.email;
  return (
    <AccountSettings current="emails" profile={profile} title="Emails">
      <SettingsSection
        id="addresses"
        title="Addresses"
        aside={isMailOn ? undefined : <SoonPill />}
        lede="Where invitations, decision requests and sign-in links will go."
      >
        {email === null ? (
          <p className={styles.empty}>
            No address yet. You signed up with a passkey, which needs none.
          </p>
        ) : (
          <table className={styles.table}>
            <tbody>
              <tr>
                <td className={styles.mono}>{email}</td>
                <td>
                  <span className={styles.current}>verified · primary</span>
                </td>
              </tr>
            </tbody>
          </table>
        )}
        <p className={styles.hint}>
          {isMailOn
            ? 'Adding another address is not built yet.'
            : `Adding an address needs this deployment to send mail${env.EMAIL_SENDER_DOMAIN === '' ? ' (no sender domain is set up yet)' : ''}. Until then Beanstalk sends nothing.`}
        </p>
      </SettingsSection>
    </AccountSettings>
  );
}
