import type { NextConfig } from 'next';

/**
 * Account pages are never cached and send no referrer off the origin. Framing is refused on
 * every response by the Worker's entry (src/security/response-headers.ts).
 */
const ACCOUNT_HEADERS = [
  { key: 'Referrer-Policy', value: 'same-origin' },
  { key: 'Cache-Control', value: 'no-store' },
];

const nextConfig: NextConfig = {
  // vinext reads every multipart POST as a possible progressive server action first and
  // refuses it (413) above this limit, route handlers included. Picture uploads are up to 2 MB
  // plus the form around them (docs/claude-opus/29-settings.md); 1 MB is the default.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
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
