'use client';

/**
 * Reloads the page once when a JavaScript or CSS chunk fails to load (a page opened before a
 * deploy asking for the old build's files; src/shell/chunk-reload.ts). Renders nothing.
 */
import { useEffect } from 'react';

import { shouldReloadFor } from '../../src/shell/chunk-reload';

export function ChunkReloadGuard() {
  useEffect(() => {
    const reloadFor = (reason: unknown) => {
      if (shouldReloadFor(reason, window.sessionStorage, Date.now())) window.location.reload();
    };
    const onError = (event: ErrorEvent) => reloadFor(event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => reloadFor(event.reason);
    // Vite's own signal for a failed preload of a dynamic import's chunks or styles.
    const onPreloadError = (event: Event) => reloadFor(Reflect.get(event, 'payload'));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('vite:preloadError', onPreloadError);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('vite:preloadError', onPreloadError);
    };
  }, []);
  return null;
}
