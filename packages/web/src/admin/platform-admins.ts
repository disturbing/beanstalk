/**
 * Platform admins: the people who see the operator's area (`/admin`: benchmark runs, the race,
 * the demo gate). They are named by handle in the web Worker's PLATFORM_ADMINS var
 * (comma-separated, any case; empty means nobody). Pure, so the rule is tested without a request.
 */

/** The handles PLATFORM_ADMINS names, lowercased (handles are case-insensitive). */
export function platformAdminHandles(configured: string): ReadonlySet<string> {
  return new Set(
    configured
      .split(',')
      .map((handle) => handle.trim().replace(/^@/, '').toLowerCase())
      .filter((handle) => handle !== ''),
  );
}

/** Whether `user` (null: signed out) is one of the configured platform admins. */
export function isPlatformAdmin(
  user: { readonly handle: string } | null,
  configured: string,
): boolean {
  if (user === null) return false;
  return platformAdminHandles(configured).has(user.handle.toLowerCase());
}
