/** Areas of the code: the directory under `src/` (or the top level), `core` for loose files. */
export function bedOf(path: string): string {
  const parts = path.split('/');
  const inside = parts[0] === 'src' ? parts.slice(1) : parts;
  return inside.length > 1 ? (inside[0] ?? 'core') : 'core';
}
