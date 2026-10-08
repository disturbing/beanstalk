/**
 * What a person did to the fake control plane (runs dispatched and cancelled, secrets named):
 * small, per repository, and kept by the caller (the web keeps it in a cookie on staging), so
 * the fake itself holds no state. Secret values never enter it.
 */
import { z } from 'zod';

const DispatchedRun = z.object({
  id: z.string(),
  workflow: z.string(),
  atMs: z.number(),
  by: z.string(),
  inputs: z.record(z.string(), z.string()),
});
export type DispatchedRun = z.infer<typeof DispatchedRun>;

const NamedSecret = z.object({
  name: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
  availableToPreland: z.boolean(),
});

const RepoOverlay = z.object({
  dispatched: z.array(DispatchedRun),
  cancelled: z.record(z.string(), z.number()),
  /** Null until the first change: the fixture's secrets. */
  secrets: z.array(NamedSecret).nullable(),
});
export type RepoOverlay = z.infer<typeof RepoOverlay>;

export const FakeOverlay = z.record(z.string(), RepoOverlay);
export type FakeOverlay = z.infer<typeof FakeOverlay>;

/** Kept small enough for one cookie: the newest runs and repositories win. */
const MAX_DISPATCHED = 8;
const MAX_CANCELLED = 12;
const MAX_REPOSITORIES = 3;

export const EMPTY_REPO_OVERLAY: RepoOverlay = { dispatched: [], cancelled: {}, secrets: null };

/** Where the fake reads and writes the overlay. */
export type OverlayStore = {
  read(): FakeOverlay;
  write(overlay: FakeOverlay): void;
};

export function repoOverlayOf(overlay: FakeOverlay, repoId: string): RepoOverlay {
  return overlay[repoId] ?? EMPTY_REPO_OVERLAY;
}

/** The overlay with one repository's part replaced, trimmed to fit a cookie. */
export function withRepoOverlay(
  overlay: FakeOverlay,
  repoId: string,
  next: RepoOverlay,
): FakeOverlay {
  const dispatched = next.dispatched.slice(-MAX_DISPATCHED);
  const cancelled = Object.fromEntries(
    Object.entries(next.cancelled)
      .toSorted((a, b) => a[1] - b[1])
      .slice(-MAX_CANCELLED),
  );
  const others = Object.entries(overlay).filter(([id]) => id !== repoId);
  return Object.fromEntries([
    ...others.slice(-(MAX_REPOSITORIES - 1)),
    [repoId, { ...next, dispatched, cancelled }],
  ]);
}

/** The overlay as a cookie value. */
export function encodeOverlay(overlay: FakeOverlay): string {
  return encodeURIComponent(JSON.stringify(overlay));
}

/** A cookie value back to the overlay (encoded once or not at all); anything unreadable is empty. */
export function decodeOverlay(value: string | undefined): FakeOverlay {
  if (value === undefined || value === '') return {};
  for (const candidate of [value, () => decodeURIComponent(value)]) {
    try {
      const text = typeof candidate === 'string' ? candidate : candidate();
      const parsed = FakeOverlay.safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data;
    } catch {
      // Not this encoding: try the next.
    }
  }
  return {};
}
