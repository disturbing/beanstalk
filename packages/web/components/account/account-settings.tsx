/**
 * The account settings frame: the person's picture and name, the section nav, the page. Every
 * `/settings/*` page renders inside it with its own section marked.
 */
import type { ReactNode } from 'react';

import type { Profile } from '@beanstalk/shared-identity/profiles';

import type { SettingsNavGroup } from '../settings/settings-shell';
import { SettingsShell } from '../settings/settings-shell';
import shell from '../settings/settings-shell.module.css';
import { Avatar } from './avatar';

export type AccountSection =
  | 'profile'
  | 'account'
  | 'emails'
  | 'passkeys'
  | 'sessions'
  | 'keys'
  | 'tokens'
  | 'notifications';

const GROUPS: readonly {
  readonly title: string;
  readonly items: readonly {
    readonly section: AccountSection;
    readonly label: string;
    readonly href: string;
  }[];
}[] = [
  {
    title: 'You',
    items: [
      { section: 'profile', label: 'Public profile', href: '/settings' },
      { section: 'account', label: 'Account', href: '/settings/account' },
      { section: 'emails', label: 'Emails', href: '/settings/emails' },
      { section: 'notifications', label: 'Notifications', href: '/settings/notifications' },
    ],
  },
  {
    title: 'Access',
    items: [
      { section: 'passkeys', label: 'Passkeys', href: '/settings/passkeys' },
      { section: 'sessions', label: 'Sessions and agents', href: '/settings/sessions' },
      { section: 'keys', label: 'SSH keys', href: '/settings/keys' },
      { section: 'tokens', label: 'Tokens', href: '/settings/tokens' },
    ],
  },
];

export function AccountSettings({
  current,
  profile,
  title,
  lede,
  children,
}: {
  readonly current: AccountSection;
  readonly profile: Profile;
  readonly title: string;
  readonly lede?: ReactNode;
  readonly children: ReactNode;
}) {
  const nav: SettingsNavGroup[] = GROUPS.map((group) => ({
    title: group.title,
    items: group.items.map((item) => ({
      href: item.href,
      label: item.label,
      isCurrent: item.section === current,
    })),
  }));
  const name = profile.displayName === '' ? profile.handle : profile.displayName;
  const who = (
    <a href={`/${profile.handle}`} className={shell.who}>
      <Avatar seed={profile.id} label={name} imageKey={profile.avatarKey} size={40} />
      <span className={shell.whoText}>
        <span className={shell.whoName}>{name}</span>
        <span className={shell.whoSub}>@{profile.handle} · your page</span>
      </span>
    </a>
  );
  return (
    <SettingsShell who={who} nav={nav} title={title} {...(lede === undefined ? {} : { lede })}>
      {children}
    </SettingsShell>
  );
}
