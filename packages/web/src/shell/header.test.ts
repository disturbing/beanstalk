import { describe, expect, it } from 'vitest';

import { NEW_MENU, SIGN_OUT_PATH, primaryLinks, userMenu } from './header-entries';
import { nextMenuIndex } from './menu-keys';

const VIEWER = {
  handle: 'ada',
  csrf: 'csrf-1',
  theme: 'system',
  docsUrl: 'https://d.test/docs/',
} as const;

describe('the header', () => {
  it('links a signed-in person to Home, their repositories and organizations', () => {
    expect(primaryLinks('ada').map((link) => link.href)).toEqual(['/', '/ada', '/orgs', '/races']);
  });

  it('shows the benchmark and the race to a signed-out visitor', () => {
    expect(primaryLinks(null).map((link) => link.label)).toEqual([
      'Benchmark runs',
      'Watch the race',
    ]);
  });

  it('offers a new repository, a new organization and connecting an agent', () => {
    expect(NEW_MENU.map((entry) => ('href' in entry ? entry.href : null))).toEqual([
      '/new',
      '/orgs/new',
      '/signup/agent',
    ]);
  });

  it('names the person, then their pages, settings, docs, the theme and sign out', () => {
    const entries = userMenu(VIEWER);
    expect(entries[0]).toEqual({ kind: 'note', label: 'Signed in as', detail: '@ada' });
    const labels = entries.flatMap((entry) => ('label' in entry ? [entry.label] : []));
    expect(labels).toEqual([
      'Signed in as',
      'Your profile',
      'Your repositories',
      'Your organizations',
      'Settings',
      'Connect an agent',
      'Docs',
      'Sign out',
    ]);
    expect(entries).toContainEqual({ kind: 'theme', initial: 'system' });
  });

  it('signs out with a POST carrying the session CSRF token', () => {
    expect(userMenu(VIEWER).at(-1)).toEqual({
      kind: 'post',
      action: SIGN_OUT_PATH,
      label: 'Sign out',
      fields: { csrf: 'csrf-1' },
    });
  });
});

describe('menu keys', () => {
  it('moves down and up with wrap-around, and jumps with Home and End', () => {
    expect(nextMenuIndex('ArrowDown', -1, 4)).toBe(0);
    expect(nextMenuIndex('ArrowDown', 3, 4)).toBe(0);
    expect(nextMenuIndex('ArrowUp', 0, 4)).toBe(3);
    expect(nextMenuIndex('ArrowUp', -1, 4)).toBe(3);
    expect(nextMenuIndex('Home', 2, 4)).toBe(0);
    expect(nextMenuIndex('End', 0, 4)).toBe(3);
  });

  it('leaves other keys and empty menus alone', () => {
    expect(nextMenuIndex('a', 0, 4)).toBeNull();
    expect(nextMenuIndex('ArrowDown', -1, 0)).toBeNull();
  });
});
