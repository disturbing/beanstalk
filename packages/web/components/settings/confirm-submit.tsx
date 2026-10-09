'use client';

/**
 * A destructive form's submit, behind a confirmation: the button opens a modal `<dialog>`
 * (focus moves into it, Escape and Cancel close it) that says what will happen; only its
 * confirm button submits the surrounding form. The dialog needs script, as the settings forms
 * that use it (server actions with a pending state) already do.
 */
import { useId, useRef } from 'react';
import type { ReactNode } from 'react';

import styles from './confirm-submit.module.css';

export function ConfirmSubmit(props: {
  /** The button that opens the dialog. */
  readonly label: string;
  /** The dialog's title and its confirm button. */
  readonly title: string;
  readonly confirmLabel: string;
  readonly children: ReactNode;
  readonly tone: 'danger' | 'plain';
  readonly buttonClassName: string | undefined;
  readonly confirmClassName: string | undefined;
  readonly disabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        className={props.buttonClassName}
        disabled={props.disabled}
        aria-haspopup="dialog"
        onClick={() => dialog.current?.showModal()}
      >
        {props.label}
      </button>
      <dialog
        ref={dialog}
        className={`${styles.dialog} ${props.tone === 'danger' ? styles.danger : ''}`}
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className={styles.title}>
          {props.title}
        </h2>
        <div className={styles.body}>{props.children}</div>
        <div className={styles.buttons}>
          <button
            type="button"
            className={styles.cancel}
            autoFocus
            onClick={() => dialog.current?.close()}
          >
            Cancel
          </button>
          <button
            type="submit"
            className={props.confirmClassName}
            onClick={() => dialog.current?.close()}
          >
            {props.confirmLabel}
          </button>
        </div>
      </dialog>
    </>
  );
}
