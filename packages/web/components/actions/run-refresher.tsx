'use client';

/**
 * Re-renders a run's page from the server every few seconds while the run can still change,
 * so the graph, the durations and the buttons keep up; the open job's log streams on its own.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const REFRESH_MS = 4000;

export function RunRefresher(props: { readonly live: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!props.live) return undefined;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [props.live, router]);
  return null;
}
