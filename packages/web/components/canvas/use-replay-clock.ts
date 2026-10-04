'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export const SPEEDS = [1, 10, 60] as const;
export type Speed = (typeof SPEEDS)[number];

export type ReplayClock = {
  readonly now: number;
  readonly playing: boolean;
  readonly speed: Speed;
  readonly end: number;
  readonly toggle: () => void;
  readonly setSpeed: (speed: Speed) => void;
  readonly seek: (t: number) => void;
};

/** How often the clock publishes while playing: enough for smooth counters, cheap to reduce. */
const TICK_MS = 100;

/**
 * The replay's clock: plays a recorded race from `now` at 1x, 10x or 60x and stops at the
 * end. Seeking works playing or paused.
 */
export function useReplayClock(options: {
  readonly end: number;
  readonly initial: number;
  readonly speed: Speed;
}): ReplayClock {
  const [now, setNow] = useState(Math.min(options.initial, options.end));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>(options.speed);
  const nowRef = useRef(now);
  const playingRef = useRef(playing);
  useEffect(() => {
    nowRef.current = now;
    playingRef.current = playing;
  }, [now, playing]);

  useEffect(() => {
    if (!playing) return undefined;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const wall = performance.now();
      const next = Math.min(options.end, nowRef.current + ((wall - last) / 1000) * speed);
      last = wall;
      setNow(next);
      if (next >= options.end) setPlaying(false);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, speed, options.end]);

  const toggle = useCallback(() => {
    if (!playingRef.current && nowRef.current >= options.end) setNow(0);
    setPlaying((current) => !current);
  }, [options.end]);
  const seek = useCallback(
    (t: number) => setNow(Math.max(0, Math.min(options.end, t))),
    [options.end],
  );
  return { now, playing, speed, end: options.end, toggle, setSpeed, seek };
}
