'use client';

import { useEffect, useState } from 'react';

import styles from './repository.module.css';

/** Copies `text` to the clipboard and says so for two seconds. */
export function CopyButton(props: {
  readonly text: string;
  readonly label?: string;
  readonly className?: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (): void => {
    navigator.clipboard.writeText(props.text).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };
  return (
    <button
      type="button"
      className={`${styles.copyButton} ${props.className ?? ''}`}
      onClick={copy}
      data-copied={copied ? '' : undefined}
      aria-label={`Copy ${props.label ?? 'to clipboard'}`}
    >
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}
