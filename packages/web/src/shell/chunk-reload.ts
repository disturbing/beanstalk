/**
 * Deploy skew: a page loaded before a deploy asks for the old build's JavaScript chunks, which
 * the new deploy no longer serves (404), and the navigation or component that needed them
 * fails. The cure is one full reload, which fetches the new build. A flag in sessionStorage
 * keeps it to one reload per few minutes, so a chunk that is missing for another reason never
 * loops.
 */

/** The flag's key in sessionStorage: when this tab last reloaded for a missing chunk. */
export const RELOAD_FLAG = 'gitstalk:chunk-reload-at';

/** A second reload within this window is a loop, not a deploy. */
const RELOAD_WINDOW_MS = 5 * 60 * 1000;

/** What browsers and the bundler say when a module or chunk could not be loaded. */
const CHUNK_ERRORS: readonly RegExp[] = [
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Unable to preload CSS/i,
  /Loading (?:CSS )?chunk [\w-]+ failed/i,
  /ChunkLoadError/,
];

export type FlagStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Whether `reason` (an error, an event's reason, or a message) is a failed chunk load. */
export function isChunkLoadError(reason: unknown): boolean {
  const text = messageOf(reason);
  return text !== '' && CHUNK_ERRORS.some((pattern) => pattern.test(text));
}

/**
 * Whether to reload for `reason` now: a chunk error, with no reload for one in the last few
 * minutes. When it answers yes, the flag is set first. Storage that throws (private modes)
 * answers no: without the flag a reload could loop.
 */
export function shouldReloadFor(reason: unknown, storage: FlagStorage, nowMs: number): boolean {
  if (!isChunkLoadError(reason)) return false;
  try {
    const last = Number(storage.getItem(RELOAD_FLAG) ?? Number.NaN);
    if (Number.isFinite(last) && nowMs - last < RELOAD_WINDOW_MS) return false;
    storage.setItem(RELOAD_FLAG, String(nowMs));
    return true;
  } catch {
    return false;
  }
}

function messageOf(reason: unknown): string {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === 'object' && reason !== null) {
    const message: unknown = Reflect.get(reason, 'message');
    return typeof message === 'string' ? message : '';
  }
  return '';
}
