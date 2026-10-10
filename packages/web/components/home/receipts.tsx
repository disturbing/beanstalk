'use client';

import { useEffect, useState } from 'react';

import type { PickReceipt } from '@gitstalk/shared-ask/pick/picker';
import styles from './home.module.css';

/** A small ⓘ beside something the picker decided; opens the decision's receipt. */
export function InfoReceipt({ receipt }: { readonly receipt: PickReceipt }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (anchor === null) return undefined;
    const close = (event: KeyboardEvent | MouseEvent) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      setAnchor(null);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('click', close);
    return () => {
      window.removeEventListener('keydown', close);
      window.removeEventListener('click', close);
    };
  }, [anchor]);
  return (
    <>
      <button
        type="button"
        className={`${styles.info} ${styles.receipt}`}
        aria-label={`${receipt.title}: what was picked and by whom`}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setAnchor(anchor === null ? event.currentTarget.getBoundingClientRect() : null);
        }}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z" />
        </svg>
      </button>
      {anchor === null ? null : (
        <div
          className={styles.popover}
          role="dialog"
          aria-label={receipt.title}
          style={popoverPosition(anchor)}
          onClick={(event) => event.stopPropagation()}
        >
          <Receipt receipt={receipt} />
        </div>
      )}
    </>
  );
}

/** The status line's picks button and the drawer listing every pick the page made. */
export function PicksDrawer(props: {
  readonly receipts: readonly PickReceipt[];
  readonly picker: 'jev' | 'rules';
}) {
  const [open, setOpen] = useState(false);
  const jev = props.receipts.filter((receipt) => receipt.by === 'jev').length;
  return (
    <>
      <button type="button" className={styles.picksbtn} onClick={() => setOpen(true)}>
        {props.picker === 'jev'
          ? `Jev ${jev}, rules ${props.receipts.length - jev}`
          : `rules ${props.receipts.length}`}
      </button>
      {open ? (
        <div className={styles.drawer} role="dialog" aria-label="Every pick on this page">
          <button type="button" className={styles.close} onClick={() => setOpen(false)}>
            Close
          </button>
          <h3>Every pick on this page</h3>
          <p className={styles.status}>
            {props.picker === 'jev'
              ? 'Jev (TypeSafe’s decision model, on Workers AI through AI Gateway) orders each candidate list. When it does not answer in time, the decision’s rule does.'
              : 'Fixed rules order each candidate list. Set PICKER to jev to let Jev decide.'}{' '}
            Code computes every candidate and every sentence; the picker only chooses among them.
          </p>
          {props.receipts.toReversed().map((receipt, index) => (
            <div key={`${receipt.decision}-${index}`} className={styles.item}>
              <Receipt receipt={receipt} />
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

function Receipt({ receipt }: { readonly receipt: PickReceipt }) {
  const order = new Map(receipt.chosen.map((id, index) => [id, index + 1]));
  return (
    <div>
      <h4>{receipt.title}</h4>
      <p className={styles.askline}>{receipt.ask}</p>
      <ul className={styles.cands}>
        {receipt.candidates.map((candidate) => (
          <li key={candidate.id} data-on={order.has(candidate.id) ? '' : undefined}>
            <b>{order.get(candidate.id) ?? ''}</b>
            <span>{candidate.label}</span>
          </li>
        ))}
      </ul>
      <p className={styles.by}>
        {receipt.by === 'jev'
          ? `Jev picked${receipt.confidence === null ? '' : `, confidence ${receipt.confidence.toFixed(2)}`}, ${receipt.ms} ms. ${receipt.why}`
          : `Rules picked. ${receipt.why}`}{' '}
        Jev reads {receipt.inputBytes.toLocaleString('en')} bytes: the question and these
        descriptions, never file contents.
      </p>
    </div>
  );
}

function popoverPosition(anchor: DOMRect): Readonly<Record<string, string>> {
  const width = Math.min(400, window.innerWidth - 32);
  const left = Math.max(16, Math.min(window.innerWidth - width - 16, anchor.right - width + 20));
  const below = anchor.bottom + 8;
  return below + 320 < window.innerHeight
    ? { left: `${left}px`, top: `${below}px` }
    : { left: `${left}px`, bottom: `${window.innerHeight - anchor.top + 8}px` };
}
