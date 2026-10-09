/**
 * What the header offers, as data: the primary links, the New menu and the signed-in person's
 * menu. Pure, so the menus are tested without rendering.
 */
import type { MenuEntry } from '../../components/shell/header-menu';
import type { ThemeChoice } from '../../components/shell/theme';

export type HeaderLink = { readonly href: string; readonly label: string };

/** Where sign-out posts (app/auth/signout/route.ts): it needs the session's CSRF token. */
export const SIGN_OUT_PATH = '/auth/signout';

export const CONNECT_AGENT_PATH = '/signup/agent';

export function primaryLinks(handle: string | null): readonly HeaderLink[] {
  if (handle === null)
    return [
      { href: '/', label: 'Benchmark runs' },
      { href: '/race', label: 'Watch the race' },
    ];
  return [
    { href: '/', label: 'Home' },
    { href: `/${handle}`, label: 'Repositories' },
    { href: '/orgs', label: 'Organizations' },
    { href: '/races', label: 'Benchmark runs' },
  ];
}

export const NEW_MENU: readonly MenuEntry[] = [
  { kind: 'link', href: '/new', label: 'New repository' },
  { kind: 'link', href: '/orgs/new', label: 'New organization' },
  { kind: 'link', href: CONNECT_AGENT_PATH, label: 'Connect an agent' },
];

export function userMenu(viewer: {
  readonly handle: string;
  readonly csrf: string;
  readonly theme: ThemeChoice;
  readonly docsUrl: string;
}): readonly MenuEntry[] {
  return [
    { kind: 'note', label: 'Signed in as', detail: `@${viewer.handle}` },
    { kind: 'separator' },
    { kind: 'link', href: `/${viewer.handle}`, label: 'Your profile' },
    { kind: 'link', href: `/${viewer.handle}#repositories`, label: 'Your repositories' },
    { kind: 'link', href: '/orgs', label: 'Your organizations' },
    { kind: 'separator' },
    { kind: 'link', href: '/settings', label: 'Settings' },
    { kind: 'link', href: CONNECT_AGENT_PATH, label: 'Connect an agent' },
    { kind: 'link', href: viewer.docsUrl, label: 'Docs', external: true },
    { kind: 'separator' },
    { kind: 'theme', initial: viewer.theme },
    { kind: 'separator' },
    { kind: 'post', action: SIGN_OUT_PATH, label: 'Sign out', fields: { csrf: viewer.csrf } },
  ];
}
