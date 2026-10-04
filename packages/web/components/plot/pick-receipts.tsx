'use client';

import { useEffect, useState } from 'react';

import type { PickReceipt } from '@beanstalk/shared-ask/pick/picker';
import styles from './plot.module.css';

const BEAN_PATH = 'M5 2.5c3-1.5 8 1 8.5 5 .5 4-3.5 7-7 6S1 9 2.5 6c.6-1.3 1.3-2.8 2.5-3.5Z';

function BeanGlyph({ size }: { readonly size: number }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
      <path d={BEAN_PATH} />
    </svg>
  );
}

/** A small marker beside something the picker decided; opens the decision's receipt. */
export function PickTag({
  receipt,
  label,
}: {
  readonly receipt: PickReceipt;
  readonly label: string;
}) {
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
        className={styles.pick}
        title={`${receipt.title}: see what was picked and by whom`}
        onClick={(event) => {
          event.stopPropagation();
          event.preventDefault();
          setAnchor(anchor === null ? event.currentTarget.getBoundingClientRect() : null);
        }}
      >
        <BeanGlyph size={11} />
        {label}
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

/** The top-bar button and drawer listing every pick the page made. */
export function PicksDrawer(props: {
  readonly receipts: readonly PickReceipt[];
  readonly picker: 'jev' | 'rules';
}) {
  const [open, setOpen] = useState(false);
  const jevCount = props.receipts.filter((receipt) => receipt.by === 'jev').length;
  return (
    <>
      <button type="button" className={styles.picksButton} onClick={() => setOpen(true)}>
        <BeanGlyph size={14} />
        <span>
          {props.receipts.length} pick{props.receipts.length === 1 ? '' : 's'}
        </span>
        <span>
          {props.picker === 'jev'
            ? `Jev ${jevCount}, rules ${props.receipts.length - jevCount}`
            : 'Rules'}
        </span>
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
              : 'Fixed rules order each candidate list. Set PICKER to jev to let Jev decide.'}
          </p>
          <p className={styles.proseSmall}>
            Code computes every candidate and every sentence from the run; the picker only chooses
            among them. Nothing here writes layout.
          </p>
          {props.receipts.toReversed().map((receipt, index) => (
            <div key={`${receipt.decision}-${index}`} className={styles.drawerItem}>
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
    <div className={styles.receipt}>
      <h4>{receipt.title}</h4>
      <p className={styles.receiptAsk}>{receipt.ask}</p>
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
          : `Rules picked. ${receipt.why}`}
        <br />
        Jev reads {receipt.inputBytes.toLocaleString('en')} bytes: the question and these
        descriptions, never file contents.
      </p>
    </div>
  );
}

function popoverPosition(anchor: DOMRect): Readonly<Record<string, string>> {
  const width = Math.min(400, window.innerWidth - 32);
  const left = Math.max(16, Math.min(window.innerWidth - width - 16, anchor.left - 20));
  const below = anchor.bottom + 8;
  return below + 320 < window.innerHeight
    ? { left: `${left}px`, top: `${below}px` }
    : { left: `${left}px`, bottom: `${window.innerHeight - anchor.top + 8}px` };
}
