/**
 * Where an org's icon is served from. Orgs store only the key the uploads API (another lane)
 * returns; this is the one place that turns a key into a URL, so the serving path changes
 * here alone (`docs/claude-opus/28-organizations.md` §6).
 */
export function orgIconSrc(iconKey: string): string {
  return `/api/uploads/${iconKey.split('/').map(encodeURIComponent).join('/')}`;
}
