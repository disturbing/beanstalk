export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** A clock frozen at `iso` that tests can move forward. */
export function fakeClock(iso = '2026-09-15T12:00:00.000Z'): Clock & { advance(ms: number): void } {
  let current = new Date(iso).getTime();
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current += ms;
    },
  };
}
