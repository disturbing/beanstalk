/** The viewer's theme: follow the system, or a fixed day or night (cookie `bs_theme`). */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_COOKIE = 'bs_theme';

/**
 * The cookie of the retired day skins (paper, blueprint; removed 2026-10-10). Nothing reads it;
 * the theme control expires it so it stops travelling with every request.
 */
export const RETIRED_DAY_COOKIE = 'bs_day';

export function parseTheme(value: string | undefined): ThemeChoice {
  return value === 'light' || value === 'dark' ? value : 'system';
}
