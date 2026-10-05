'use client';

import { useEffect, useState } from 'react';

import type { DayVariant, ThemeChoice } from './theme';
import { DAY_COOKIE, DAY_VARIANTS, THEME_COOKIE } from './theme';

const YEAR = 31536000;

/**
 * Day or night: follows the system until the viewer picks one, then remembers the pick in a
 * cookie so pages render in it. In day, a small menu picks the day mode.
 */
export function ThemeToggle(props: { readonly initial: ThemeChoice; readonly day: DayVariant }) {
  const [theme, setTheme] = useState<ThemeChoice>(props.initial);
  const [day, setDay] = useState<DayVariant>(props.day);
  const systemDark = useSystemDark();
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  const pick = (next: 'light' | 'dark') => {
    document.documentElement.dataset['theme'] = next;
    document.cookie = `${THEME_COOKIE}=${next}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
    setTheme(next);
  };
  const pickDay = (next: DayVariant) => {
    document.documentElement.dataset['day'] = next;
    document.cookie = `${DAY_COOKIE}=${next}; Path=/; Max-Age=${YEAR}; SameSite=Lax`;
    setDay(next);
  };
  return (
    <div className="daynight" role="group" aria-label="Day or night">
      <button type="button" aria-pressed={!dark} onClick={() => pick('light')} title="Day">
        ☀
      </button>
      <button type="button" aria-pressed={dark} onClick={() => pick('dark')} title="Night">
        ☾
      </button>
      {dark ? null : (
        <select
          aria-label="Day mode"
          value={day}
          onChange={(event) =>
            pickDay(DAY_VARIANTS.find((variant) => variant === event.target.value) ?? 'phosphor')
          }
        >
          {DAY_VARIANTS.map((variant) => (
            <option key={variant} value={variant}>
              {variant}
            </option>
          ))}
        </select>
      )}
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
