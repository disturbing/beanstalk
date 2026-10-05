/**
 * Who is looking, from the request's cookies: their theme, and whether they signed in with
 * the demo password (needed to answer decision cards). Server-only.
 */
import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';

import type { DayVariant, ThemeChoice } from '../../components/shell/theme';
import { DAY_COOKIE, THEME_COOKIE, parseDay, parseTheme } from '../../components/shell/theme';
import { SESSION_COOKIE, isValidSession } from '../auth/session';

export async function viewerTheme(): Promise<ThemeChoice> {
  const jar = await cookies();
  return parseTheme(jar.get(THEME_COOKIE)?.value);
}

export async function viewerDay(): Promise<DayVariant> {
  const jar = await cookies();
  return parseDay(jar.get(DAY_COOKIE)?.value);
}

export async function isSignedIn(): Promise<boolean> {
  const jar = await cookies();
  return isValidSession(jar.get(SESSION_COOKIE)?.value, demoPassword(), Date.now() / 1000);
}

/** The configured demo password, or '' when decisions are switched off. */
export function demoPassword(): string {
  return typeof env.DEMO_PASSWORD === 'string' ? env.DEMO_PASSWORD : '';
}
