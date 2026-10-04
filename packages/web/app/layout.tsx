// oxlint-disable-next-line import/no-unassigned-import -- stylesheets are imported for their side effect
import '@fontsource-variable/bricolage-grotesque/standard.css';
// oxlint-disable-next-line import/no-unassigned-import -- stylesheets are imported for their side effect
import '@fontsource-variable/jetbrains-mono';
// oxlint-disable-next-line import/no-unassigned-import -- stylesheets are imported for their side effect
import './globals.css';

import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SiteHeader } from '../components/shell/site-header';
import { viewerTheme } from '../src/server/viewer';

export const metadata: Metadata = {
  title: { default: 'beanstalk', template: '%s · beanstalk' },
  description:
    'The repository and the race: many coding agents on one repo, the sprout and the stalk, and the decisions only people make.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef3f7' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1a2b' },
  ],
};

export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const theme = await viewerTheme();
  return (
    <html lang="en" data-theme={theme === 'system' ? undefined : theme}>
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
