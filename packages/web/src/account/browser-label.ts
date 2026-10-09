/**
 * A browser's user agent as a person would name it: "Chrome on macOS". Rough on purpose: it
 * only helps someone tell their own browsers apart in Settings.
 */
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/HeadlessChrome\//, 'Headless Chrome'],
  [/Chrome\//, 'Chrome'],
  [/Safari\//, 'Safari'],
];

const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/iPhone|iPad/, 'iOS'],
  [/Android/, 'Android'],
  [/Mac OS X|Macintosh/, 'macOS'],
  [/Windows/, 'Windows'],
  [/CrOS/, 'ChromeOS'],
  [/Linux/, 'Linux'],
];

export function browserLabel(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === '') return 'Unknown browser';
  const browser = BROWSERS.find(([pattern]) => pattern.test(userAgent))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(userAgent))?.[1];
  if (browser === undefined && system === undefined) return userAgent.slice(0, 40);
  if (browser === undefined) return `A browser on ${system ?? ''}`;
  return system === undefined ? browser : `${browser} on ${system}`;
}
