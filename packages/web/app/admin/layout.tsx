import type { ReactNode } from 'react';

import { AdminBar } from '../../components/admin/admin-bar';
import { requirePlatformAdmin } from '../../src/admin/admin-gate';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';

/**
 * The admin area (platform admins only, PLATFORM_ADMINS): the strip of admin pages above each
 * one. Everyone else gets the ordinary 404; each page also checks, so no page relies on this.
 */
export default async function AdminLayout({ children }: { readonly children: ReactNode }) {
  await requirePlatformAdmin();
  return (
    <>
      <AdminBar />
      {children}
    </>
  );
}
