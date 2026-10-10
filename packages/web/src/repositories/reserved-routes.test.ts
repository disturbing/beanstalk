import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { Handle } from '@gitstalk/shared-identity/users';

import { isReservedOwner } from './paths';

/** The router's top-level static segments: `app/<segment>/`, minus dynamic ones and groups. */
function topLevelRoutes(): string[] {
  const app = fileURLToPath(new URL('../../app', import.meta.url));
  return readdirSync(app, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('[') && !name.startsWith('(') && !name.startsWith('_'));
}

describe('handles and the app’s routes', () => {
  const routes = topLevelRoutes();

  it('finds the router’s top-level routes', () => {
    expect(routes).toEqual(expect.arrayContaining(['api', 'new', 'runs', 'settings', 'signup']));
  });

  it.each(routes)('refuses %s as a handle at sign-up', (route) => {
    expect(Handle.safeParse(route).success).toBe(false);
    expect(Handle.safeParse(route.toUpperCase()).success).toBe(false);
  });

  it.each(routes)('never reads /%s as an owner’s page', (route) => {
    expect(isReservedOwner(route)).toBe(true);
  });

  it.each([
    'git',
    'mcp',
    'oauth',
    'tokens',
    'admin',
    'about',
    'signin',
    'logout',
    'beanstalk-race',
  ])('reserves %s, which other Workers or the product take', (name) => {
    expect(Handle.safeParse(name).success).toBe(false);
  });

  it('still accepts an ordinary handle', () => {
    expect(Handle.safeParse('coop').success).toBe(true);
    expect(isReservedOwner('coop')).toBe(false);
  });
});
