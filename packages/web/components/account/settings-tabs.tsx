import Link from 'next/link';

import styles from './account.module.css';

export function SettingsTabs({ current }: { readonly current: 'account' | 'tokens' | 'keys' }) {
  return (
    <nav aria-label="Settings" className={styles.tabs}>
      <Link href="/settings" aria-current={current === 'account' ? 'page' : undefined}>
        Account
      </Link>
      <Link href="/settings/keys" aria-current={current === 'keys' ? 'page' : undefined}>
        SSH keys
      </Link>
      <Link href="/settings/tokens" aria-current={current === 'tokens' ? 'page' : undefined}>
        Tokens
      </Link>
    </nav>
  );
}
