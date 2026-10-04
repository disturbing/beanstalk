'use client';

import { useState } from 'react';

import type { ThemeChoice } from './theme';
import { THEME_COOKIE, nextTheme, themeLabel } from './theme';

/** Cycles system → light → dark, remembers the choice in a cookie so pages render in it. */
export function ThemeToggle({ initial }: { readonly initial: ThemeChoice }) {
  const [theme, setTheme] = useState<ThemeChoice>(initial);
  const next = nextTheme(theme);
  const apply = () => {
    const root = document.documentElement;
    if (next === 'system') {
      delete root.dataset['theme'];
      document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
    } else {
      root.dataset['theme'] = next;
      document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    }
    setTheme(next);
  };
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={apply}
      aria-label={`Theme: ${themeLabel(theme)}. Switch to ${themeLabel(next)}.`}
      title={`Theme: ${themeLabel(theme)}`}
    >
      <ThemeIcon theme={theme} />
      <span className="theme-toggle__label">{themeLabel(theme)}</span>
    </button>
  );
}

function ThemeIcon({ theme }: { readonly theme: ThemeChoice }) {
  if (theme === 'light') {
    return (
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <circle cx="10" cy="10" r="3.6" />
        <path
          d="M10 1.8v2.4M10 15.8v2.4M1.8 10h2.4M15.8 10h2.4M4.2 4.2l1.7 1.7M14.1 14.1l1.7 1.7M4.2 15.8l1.7-1.7M14.1 5.9l1.7-1.7"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (theme === 'dark') {
    return (
      <svg
        viewBox="0 0 20 20"
        width="16"
        height="16"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      >
        <path d="M15.6 12.9A6.6 6.6 0 0 1 7.1 4.4a6.6 6.6 0 1 0 8.5 8.5Z" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg
      viewBox="0 0 20 20"
      width="16"
      height="16"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="10" cy="10" r="7" />
      <path d="M10 3a7 7 0 0 1 0 14Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
