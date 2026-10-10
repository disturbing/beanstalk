/**
 * Metadata for the app's public pages (sign-up, sign-in): canonical link, Open Graph and
 * Twitter card. Paths are relative; the root layout's `metadataBase` (WEB_URL) makes them
 * absolute on each deployment's own origin.
 */
import type { Metadata } from 'next';

/** The product's name in titles and link previews. */
export const PRODUCT_NAME = 'Gitstalk';

/** What a public page says about itself. */
export type PublicPage = {
  /** Its canonical path (`/signup`). */
  readonly path: string;
  /** Its own title, without the product name (the layout's template adds it). */
  readonly title: string;
  readonly description: string;
};

/** Title, description, canonical URL and link-preview tags for a public page. */
export function publicPageMetadata(page: PublicPage): Metadata {
  const title = `${page.title} · ${PRODUCT_NAME}`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      type: 'website',
      siteName: PRODUCT_NAME,
      title,
      description: page.description,
      url: page.path,
    },
    twitter: { card: 'summary', title, description: page.description },
  };
}
