import { AccountSettings } from '../../../components/account/account-settings';
import styles from '../../../components/account/account.module.css';
import { SettingsSection, SoonPill } from '../../../components/settings/settings-shell';
import { accountPage } from '../../../src/server/account-page';

export const metadata = { title: 'Notifications' };
/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

/** What Beanstalk will tell people about once it sends anything (backlog 3.3). */
const PLANNED = [
  ['A decision is waiting for you', 'a card on a repository where you answer them'],
  ['Your bean fell off the sprout', 'red after landing, or dropped by the engine'],
  ['An invitation', 'someone added you to a repository'],
  ['A daily digest', 'what landed in your repositories'],
] as const;

/** Settings → Notifications: a placeholder that says what is coming and that nothing is sent. */
export default async function NotificationSettingsPage() {
  const { profile } = await accountPage('/settings/notifications');
  return (
    <AccountSettings current="notifications" profile={profile} title="Notifications">
      <SettingsSection
        id="planned"
        title="What you will hear about"
        aside={<SoonPill />}
        lede="Beanstalk sends no email or push today: Home shows invitations and decisions when you visit. These are the notifications planned, each with its own switch."
      >
        <table className={styles.table}>
          <tbody>
            {PLANNED.map(([what, detail]) => (
              <tr key={what}>
                <td>
                  <b>{what}</b>
                  <br />
                  <span className={styles.muted}>{detail}</span>
                </td>
                <td>
                  <label className={styles.inline}>
                    <input
                      type="checkbox"
                      disabled
                      defaultChecked
                      aria-describedby="planned-title"
                    />
                    <span className={styles.muted}>Email</span>
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SettingsSection>
    </AccountSettings>
  );
}
