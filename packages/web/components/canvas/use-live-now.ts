'use client';

import { useEffect, useState } from 'react';

/** The live race second, ticking once a second until the race ends. */
export function useLiveNow(
  epochMs: number | null,
  endedAt: number | null,
  fallback: number,
): number {
  const [now, setNow] = useState(fallback);
  useEffect(() => {
    if (endedAt !== null || epochMs === null) return undefined;
    const tick = () => setNow(Math.max(fallback, (Date.now() - epochMs) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [epochMs, endedAt, fallback]);
  return endedAt ?? Math.max(now, fallback);
}
