'use client';

import { useEffect } from 'react';

/** `/` focuses the Ask box from anywhere on the page (not while typing elsewhere). */
export function AskShortcut({ target }: { readonly target: string }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      )
        return;
      const input = document.getElementById(target);
      if (!(input instanceof HTMLInputElement)) return;
      event.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target]);
  return null;
}
