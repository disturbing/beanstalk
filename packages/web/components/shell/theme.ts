/** The viewer's theme: follow the system, or a fixed light or dark (cookie `bs_theme`). */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_COOKIE = 'bs_theme';

export function parseTheme(value: string | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function nextTheme(theme: ThemeChoice): ThemeChoice {
  if (theme === 'system') return 'light';
  if (theme === 'light') return 'dark';
  return 'system';
}

export function themeLabel(theme: ThemeChoice): string {
  if (theme === 'system') return 'System';
  return theme === 'light' ? 'Light' : 'Dark';
}
