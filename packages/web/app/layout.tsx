// oxlint-disable-next-line import/no-unassigned-import -- stylesheets are imported for their side effect
import '@fontsource-variable/space-grotesk';
// oxlint-disable-next-line import/no-unassigned-import -- stylesheets are imported for their side effect
import '@fontsource-variable/jetbrains-mono';
// oxlint-disable-next-line import/no-unassigned-import -- stylesheets are imported for their side effect
import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SiteHeader } from '../components/shell/site-header';
import { viewerDay, viewerTheme } from '../src/server/viewer';

export const metadata: Metadata = {
  title: { default: 'beanstalk', template: '%s · beanstalk' },
  description:
    'The repository and the race: many coding agents on one repo, the sprout and the stalk, and the decisions only people make.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#dfe8e3' },
    { media: '(prefers-color-scheme: dark)', color: '#05080b' },
  ],
};

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const [theme, day] = await Promise.all([viewerTheme(), viewerDay()]);
  return (
    <html lang="en" data-theme={theme === 'system' ? undefined : theme} data-day={day}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <SiteHeader />
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
