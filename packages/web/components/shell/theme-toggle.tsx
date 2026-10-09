'use client';

import { useEffect, useState } from 'react';

import type { ThemeChoice } from './theme';
import { RETIRED_DAY_COOKIE, THEME_COOKIE } from './theme';

const YEAR = 31536000;

/** Day or night, as the page shows it now, and a way to pick one. */
export type ThemeControl = {
  readonly isDark: boolean;
  readonly pick: (next: 'light' | 'dark') => void;
};

/**
 * Day or night: follows the system until the viewer picks one, then remembers the pick in a
 * cookie so pages render in it.
 */
export function useTheme(initial: ThemeChoice): ThemeControl {
  const [theme, setTheme] = useState<ThemeChoice>(initial);
  const systemDark = useSystemDark();
  useEffect(() => {
    document.cookie = `${RETIRED_DAY_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }, []);
  const pick = (next: 'light' | 'dark') => {
    document.documentElement.dataset['theme'] = next;
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
    setTheme(next);
  };
  return { isDark: theme === 'dark' || (theme === 'system' && systemDark), pick };
}

/** The sun and moon pair, for the signed-out header. */
export function ThemeToggle(props: { readonly initial: ThemeChoice }) {
  const { isDark, pick } = useTheme(props.initial);
  return (
    <div className="daynight" role="group" aria-label="Day or night">
      <button type="button" aria-pressed={!isDark} onClick={() => pick('light')} title="Day">
        <span aria-hidden="true">☀</span>
        <span className="visually-hidden">Day</span>
      </button>
      <button type="button" aria-pressed={isDark} onClick={() => pick('dark')} title="Night">
        <span aria-hidden="true">☾</span>
        <span className="visually-hidden">Night</span>
      </button>
    </div>
  );
}

function useSystemDark(): boolean {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    setDark(query.matches);
    const onChange = (event: MediaQueryListEvent) => setDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return dark;
}
