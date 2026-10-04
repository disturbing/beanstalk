import { describe, expect, it } from 'vitest';

import { isDemoPassword, isValidSession, sessionToken } from './session';

const PASSWORD = 'correct horse battery staple';
const NOW = 1_800_000_000;

describe('the demo gate', () => {
  it('accepts the demo password and refuses anything else', async () => {
    expect(await isDemoPassword(PASSWORD, PASSWORD)).toBe(true);
    expect(await isDemoPassword('correct horse', PASSWORD)).toBe(false);
  });

  it('refuses every password when none is configured', async () => {
    expect(await isDemoPassword('', '')).toBe(false);
  });

  it('honours a session token until it expires', async () => {
    const token = await sessionToken(PASSWORD, NOW + 60);
    expect(await isValidSession(token, PASSWORD, NOW)).toBe(true);
    expect(await isValidSession(token, PASSWORD, NOW + 61)).toBe(false);
  });

  it('refuses a token signed with another password or tampered with', async () => {
    const token = await sessionToken(PASSWORD, NOW + 60);
    expect(await isValidSession(token, 'another password', NOW)).toBe(false);
    expect(await isValidSession(token.replace(/^\d+/, String(NOW + 9999)), PASSWORD, NOW)).toBe(
      false,
    );
    expect(await isValidSession(undefined, PASSWORD, NOW)).toBe(false);
    expect(await isValidSession('garbage', PASSWORD, NOW)).toBe(false);
  });
});
