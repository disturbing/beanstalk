'use client';

/**
 * Follows a repository's engine (the Changes list always, a bean's page while it is open):
 * the server bridges the engine's feed to Server-Sent Events, and each batch of new events
 * re-renders the page from the server (one refresh per burst), so the lists and the journey
 * stay the server's own.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import styles from './repo-tabs.module.css';

/** Events arriving within this window cause one refresh. */
const BURST_MS = 400;

type Status = 'connecting' | 'live' | 'reconnecting';

export function LiveRefresh(props: {
  /** The feed's path; `?after=<seq>` resumes it. */
  readonly path: string;
  readonly after: number;
  readonly enabled: boolean;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('connecting');
  useEffect(() => {
    if (!props.enabled) return undefined;
    const source = new EventSource(`${props.path}?after=${props.after}`);
    let timer: ReturnType<typeof setTimeout> | null = null;
    source.addEventListener('open', () => setStatus('live'));
    source.addEventListener('error', () => setStatus('reconnecting'));
    source.addEventListener('events', () => {
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, BURST_MS);
    });
    source.addEventListener('end', () => source.close());
    return () => {
      if (timer !== null) clearTimeout(timer);
      source.close();
    };
  }, [props.path, props.after, props.enabled, router]);
  if (!props.enabled) return null;
  return (
    <span className={styles.live} data-status={status} role="status">
      <i aria-hidden="true" />
      {status === 'live' ? 'Live' : 'Connecting…'}
    </span>
  );
}
