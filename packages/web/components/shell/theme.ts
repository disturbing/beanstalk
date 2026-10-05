/** The viewer's theme: follow the system, or a fixed light or dark (cookie `bs_theme`). */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_COOKIE = 'bs_theme';

export function parseTheme(value: string | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Which day mode Nightshift uses in light: phosphor (default), paper or blueprint (cookie `bs_day`). */
export type DayVariant = 'phosphor' | 'paper' | 'blueprint';

export const DAY_COOKIE = 'bs_day';
export const DAY_VARIANTS: readonly DayVariant[] = ['phosphor', 'paper', 'blueprint'];

export function parseDay(value: string | undefined): DayVariant {
  return value === 'paper' || value === 'blueprint' ? value : 'phosphor';
}
