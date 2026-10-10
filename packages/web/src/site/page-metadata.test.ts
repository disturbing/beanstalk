import { describe, expect, it } from 'vitest';

import { publicPageMetadata } from './page-metadata';

describe('a public page’s metadata', () => {
  const metadata = publicPageMetadata({
    path: '/signup',
    title: 'Sign up',
    description: 'Create a Gitstalk account.',
  });

  it('names the page; the root layout’s template adds the product', () => {
    expect(metadata.title).toBe('Sign up');
    expect(metadata.description).toBe('Create a Gitstalk account.');
  });

  it('gives a relative canonical and og:url for the layout’s metadataBase to resolve', () => {
    expect(metadata.alternates?.canonical).toBe('/signup');
    expect(metadata.openGraph).toMatchObject({
      url: '/signup',
      title: 'Sign up · Gitstalk',
      siteName: 'Gitstalk',
      description: 'Create a Gitstalk account.',
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Sign up · Gitstalk',
      images: ['/og-image.png'],
    });
  });

  it('shares the social card as its link preview image', () => {
    expect(metadata.openGraph?.images).toEqual([
      expect.objectContaining({ url: '/og-image.png', width: 1200, height: 630 }),
    ]);
  });
});
