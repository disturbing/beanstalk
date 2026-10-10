// oxlint-disable-next-line import/no-unassigned-import -- stylesheets are imported for their side effect
import '@fontsource-variable/space-grotesk';
// oxlint-disable-next-line import/no-unassigned-import -- stylesheets are imported for their side effect
import '@fontsource-variable/jetbrains-mono';
// oxlint-disable-next-line import/no-unassigned-import -- stylesheets are imported for their side effect
import './globals.css';

import { env } from 'cloudflare:workers';
import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { SiteHeader } from '../components/shell/site-header';
import { viewerTheme } from '../src/server/viewer';
import { PRODUCT_NAME, SOCIAL_CARD } from '../src/site/page-metadata';

/**
 * Every page's defaults. `metadataBase` is this deployment's origin (WEB_URL), so a page's
 * relative canonical and Open Graph URLs resolve on gitstalk.io, gitstalk.dev or a fork's host.
 */
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(env.WEB_URL),
    title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` },
    description:
      'The agent-first git forge: many coding agents on one repository, the sprout and the stalk, and the decisions only people make.',
    openGraph: { type: 'website', siteName: PRODUCT_NAME, images: [SOCIAL_CARD] },
    twitter: { card: 'summary_large_image', images: [SOCIAL_CARD.url] },
  };
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#dfe8e3' },
    { media: '(prefers-color-scheme: dark)', color: '#05080b' },
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
