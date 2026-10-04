import type { BeanStatus } from '../../src/forge/forge-source';
import styles from './explorer.module.css';

const LABELS: Readonly<Record<BeanStatus, string>> = {
  pending: 'not started',
  'in-flight': 'in flight',
  landed: 'on the sprout',
  green: 'on the stalk',
  reverted: 'reverted',
  dropped: 'dropped',
};

const PILL: Readonly<Record<BeanStatus, string | undefined>> = {
  pending: styles.pillPending,
  'in-flight': styles.pillFlight,
  landed: styles.pillLanded,
  green: styles.pillGreen,
  reverted: styles.pillRed,
  dropped: styles.pillDropped,
};

const BEAD: Readonly<Record<BeanStatus, string | undefined>> = {
  pending: styles.beadDropped,
  'in-flight': styles.beadFlight,
  landed: styles.beadLanded,
  green: styles.beadGreen,
  reverted: styles.beadRed,
  dropped: styles.beadDropped,
};

/** A bean's status as a word with its shape, never colour alone. */
export function StatusPill({ status }: { readonly status: BeanStatus }) {
  return (
    <span className={`${styles.pill} ${PILL[status] ?? ''}`}>
      <StatusGlyph status={status} />
      {LABELS[status]}
    </span>
  );
}

export function beadClass(status: BeanStatus): string {
  return `${styles.bead} ${BEAD[status] ?? ''}`;
}

export function statusLabel(status: BeanStatus): string {
  return LABELS[status];
}

function StatusGlyph({ status }: { readonly status: BeanStatus }) {
  const common = { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': true } as const;
  switch (status) {
    case 'green':
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="4" fill="currentColor" />
        </svg>
      );
    case 'landed':
      return (
        <svg {...common}>
          <circle cx="5" cy="5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'in-flight':
      return (
        <svg {...common}>
          <path d="M5 1 9 5 5 9 1 5Z" fill="currentColor" />
        </svg>
      );
    case 'reverted':
      return (
        <svg {...common}>
          <path d="M2 2 8 8M8 2 2 8" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      );
    case 'dropped':
    case 'pending':
      return (
        <svg {...common}>
          <circle
            cx="5"
            cy="5"
            r="3.2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeDasharray="2 1.4"
          />
        </svg>
      );
    default:
      return null;
  }
}
