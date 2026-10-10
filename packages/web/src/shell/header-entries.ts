/**
 * What the header offers, as data: the primary links, the New menu and the signed-in person's
 * menu. Pure, so the menus are tested without rendering.
 */
import type { MenuEntry } from '../../components/shell/header-menu';
import type { ThemeChoice } from '../../components/shell/theme';
import { ADMIN_HOME } from '../admin/admin-paths';

export type HeaderLink = { readonly href: string; readonly label: string };

/** Where sign-out posts (app/auth/signout/route.ts): it needs the session's CSRF token. */
export const SIGN_OUT_PATH = '/auth/signout';

export const CONNECT_AGENT_PATH = '/signup/agent';

/** Signed in: Home, their repositories and organizations. Signed out: none (Sign in, Sign up). */
export function primaryLinks(handle: string | null): readonly HeaderLink[] {
  if (handle === null) return [];
  return [
    { href: '/', label: 'Home' },
    { href: `/${handle}`, label: 'Repositories' },
    { href: '/orgs', label: 'Organizations' },
  ];
}

export const NEW_MENU: readonly MenuEntry[] = [
  { kind: 'link', href: '/new', label: 'New repository' },
  { kind: 'link', href: '/orgs/new', label: 'New organization' },
  { kind: 'link', href: CONNECT_AGENT_PATH, label: 'Connect an agent' },
];

const ADMIN_ENTRY: MenuEntry = { kind: 'link', href: ADMIN_HOME, label: 'Admin' };

export function userMenu(viewer: {
  readonly handle: string;
  readonly csrf: string;
  readonly theme: ThemeChoice;
  readonly docsUrl: string;
  /** A platform admin (PLATFORM_ADMINS) also gets the admin area. */
  readonly isPlatformAdmin: boolean;
}): readonly MenuEntry[] {
  const admin: readonly MenuEntry[] = viewer.isPlatformAdmin ? [ADMIN_ENTRY] : [];
  return [
    { kind: 'note', label: 'Signed in as', detail: `@${viewer.handle}` },
    { kind: 'separator' },
    { kind: 'link', href: `/${viewer.handle}`, label: 'Your profile' },
    { kind: 'link', href: `/${viewer.handle}#repositories`, label: 'Your repositories' },
    { kind: 'link', href: '/orgs', label: 'Your organizations' },
    { kind: 'separator' },
    { kind: 'link', href: '/settings', label: 'Settings' },
    ...admin,
    { kind: 'link', href: CONNECT_AGENT_PATH, label: 'Connect an agent' },
    { kind: 'link', href: viewer.docsUrl, label: 'Docs', external: true },
    { kind: 'separator' },
    { kind: 'theme', initial: viewer.theme },
    { kind: 'separator' },
    { kind: 'post', action: SIGN_OUT_PATH, label: 'Sign out', fields: { csrf: viewer.csrf } },
  ];
}
