/**
 * Pictures for people and organisations that have not uploaded one: initials on a tile for a
 * person, a symmetric 5×5 identicon for an organisation. Both are derived from a stable seed
 * (the account id, so a handle change keeps the colour) and drawn by our own code, so the SVG
 * holds nothing a user typed except escaped initials.
 */

export type FallbackAvatar = {
  /** One or two letters, upper case. */
  readonly initials: string;
  /** 0–359: the tile's hue. */
  readonly hue: number;
  /** Rows of the identicon, each five cells, mirrored left to right. */
  readonly cells: readonly (readonly boolean[])[];
};

export function fallbackAvatar(seed: string, label: string): FallbackAvatar {
  const hash = fnv1a(seed);
  return { initials: initialsOf(label), hue: hash % 360, cells: identiconCells(hash) };
}

/** "Coop Smith" → "CS", "dana" → "D", "acme-labs" → "AL"; "?" when there is nothing. */
export function initialsOf(label: string): string {
  const words = label
    .replace(/^@/, '')
    .split(/[\s._-]+/)
    .filter((word) => /^[\p{L}\p{N}]/u.test(word));
  const letters = words.slice(0, 2).map((word) => Array.from(word)[0] ?? '');
  const initials = letters.join('').toUpperCase();
  return initials === '' ? '?' : initials;
}

/** The fallback as a standalone SVG document (for an `<img>` or a download). */
export function fallbackAvatarSvg(
  avatar: FallbackAvatar,
  style: 'initials' | 'identicon',
  size = 128,
): string {
  const background = `hsl(${avatar.hue} 45% 32%)`;
  const ink = `hsl(${avatar.hue} 80% 88%)`;
  const body =
    style === 'initials'
      ? `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="system-ui,sans-serif" font-weight="650" font-size="${avatar.initials.length > 1 ? 44 : 54}" fill="${ink}">${escapeXml(avatar.initials)}</text>`
      : identiconRects(avatar.cells, ink);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100" role="img"><rect width="100" height="100" fill="${background}"/>${body}</svg>`;
}

function identiconCells(hash: number): boolean[][] {
  const rows: boolean[][] = [];
  for (let row = 0; row < 5; row += 1) {
    const left = [0, 1, 2].map((column) => ((hash >>> (row * 3 + column + 6)) & 1) === 1);
    rows.push([
      left[0] ?? false,
      left[1] ?? false,
      left[2] ?? false,
      left[1] ?? false,
      left[0] ?? false,
    ]);
  }
  return rows;
}

function identiconRects(cells: readonly (readonly boolean[])[], ink: string): string {
  return cells
    .flatMap((row, y) =>
      row.map((on, x) =>
        on
          ? `<rect x="${10 + x * 16}" y="${10 + y * 16}" width="16" height="16" fill="${ink}"/>`
          : '',
      ),
    )
    .join('');
}

/** 32-bit FNV-1a: small, stable, good enough to spread colours. */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (char) => `&#${char.charCodeAt(0)};`);
}
