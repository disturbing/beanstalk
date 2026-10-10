/**
 * Metadata for the app's public pages (sign-up, sign-in): canonical link, Open Graph and
 * Twitter card. Paths are relative; the root layout's `metadataBase` (WEB_URL) makes them
 * absolute on each deployment's own origin.
 */
import type { Metadata } from 'next';

/** The product's name in titles and link previews. */
export const PRODUCT_NAME = 'Gitstalk';

/**
 * The social card every page shares as its Open Graph image (rendered from
 * packages/site/social/og-image.html). The site and the web app both serve it at `url`, which
 * the root layout's `metadataBase` makes absolute.
 */
export const SOCIAL_CARD = {
  url: '/og-image.png',
  width: 1200,
  height: 630,
  alt: 'Gitstalk: watch your work grow like a beanstalk. Agents grow together.',
} as const;

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
      images: [SOCIAL_CARD],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: page.description,
      images: [SOCIAL_CARD.url],
    },
  };
}
