import styles from './account.module.css';

export function ScopeChips({ scopes }: { readonly scopes: readonly string[] }) {
  return (
    <span className={styles.chips}>
      {scopes.map((scope) => (
        <span
          key={scope}
          className={scope === 'write' ? `${styles.chip} ${styles.chipWrite}` : styles.chip}
        >
          {scope}
        </span>
      ))}
    </span>
  );
}

const DATE = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });

/** A date for lists (UTC, so server and browser agree). */
export function formatDate(ms: number | null): string {
  return ms === null ? '—' : DATE.format(new Date(ms));
}
