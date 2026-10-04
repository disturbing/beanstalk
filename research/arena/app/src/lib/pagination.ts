const MAX_LIMIT = 100;

/**
 * Slice `items` according to `?limit=` and `?offset=`. Bad values fall back to the
 * defaults rather than failing the request.
 */
export function paginate<T>(items: T[], query: Record<string, string>, defaultLimit = 20): T[] {
  const requested = Number.parseInt(query.limit ?? '', 10);
  const limit = Number.isNaN(requested) ? defaultLimit : Math.min(Math.max(requested, 1), MAX_LIMIT);
  const offset = Math.max(Number.parseInt(query.offset ?? '', 10) || 0, 0);
  return items.slice(offset, offset + limit);
}
