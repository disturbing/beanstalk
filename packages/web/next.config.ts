import type { NextConfig } from 'next';

/** Account pages are never framed (clickjacking on consent and tokens) and never cached. */
const ACCOUNT_HEADERS = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Cache-Control', value: 'no-store' },
];

const nextConfig: NextConfig = {
  headers: async () =>
    [
      '/login',
      '/signup',
      '/signup/:path*',
      '/connect',
      '/connect/:path*',
      '/settings',
      '/settings/:path*',
    ].map((source) => ({
      source,
      headers: ACCOUNT_HEADERS,
    })),
};

export default nextConfig;
