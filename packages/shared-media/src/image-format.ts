/**
 * What an uploaded file really is, read from its bytes (never from its name or the type the
 * browser claimed): PNG, JPEG, WebP or GIF with their pixel dimensions. SVG is refused by
 * name because it can carry scripts. Also the metadata strip used when no Images binding
 * re-encodes the upload: location and camera data leave, the JPEG orientation stays.
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'gif';

export type SniffedImage = {
  readonly format: ImageFormat;
  readonly contentType: `image/${ImageFormat}`;
  readonly width: number;
  readonly height: number;
};

/** Why bytes are not an image we take: another type, an SVG, or a header that does not parse. */
export type SniffFailure = 'unsupported' | 'svg' | 'corrupt';

export type SniffResult =
  | { readonly ok: true; readonly image: SniffedImage }
  | { readonly ok: false; readonly reason: SniffFailure };

/** The content types this library stores and serves. */
export const IMAGE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

export function sniffImage(bytes: Uint8Array): SniffResult {
  const format = formatOf(bytes);
  if (format === null) return { ok: false, reason: looksLikeSvg(bytes) ? 'svg' : 'unsupported' };
  const size = dimensionsOf(format, bytes);
  if (size === null) return { ok: false, reason: 'corrupt' };
  return { ok: true, image: { format, contentType: `image/${format}`, ...size } };
}

/**
 * The bytes without metadata a person may not mean to publish: PNG text and EXIF chunks; JPEG
 * EXIF, XMP and comments (the EXIF orientation is written back on its own, so photos stay
 * upright). WebP and GIF are returned as they are.
 */
export function stripMetadata(format: ImageFormat, bytes: Uint8Array): Uint8Array {
  if (format === 'png') return stripPng(bytes);
  if (format === 'jpeg') return stripJpeg(bytes);
  return bytes;
}

type Size = { readonly width: number; readonly height: number };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function formatOf(bytes: Uint8Array): ImageFormat | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  return null;
}

function dimensionsOf(format: ImageFormat, bytes: Uint8Array): Size | null {
  switch (format) {
    case 'png':
      return ascii(bytes, 12, 4) === 'IHDR' && bytes.length >= 24
        ? positive(u32be(bytes, 16), u32be(bytes, 20))
        : null;
    case 'gif':
      return bytes.length >= 10 ? positive(u16le(bytes, 6), u16le(bytes, 8)) : null;
    case 'webp':
      return webpSize(bytes);
    case 'jpeg':
      return jpegSize(bytes);
    default:
      return assertNever(format);
  }
}

function webpSize(bytes: Uint8Array): Size | null {
  if (bytes.length < 25) return null;
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    if (bytes.length < 30) return null;
    const hasStartCode = bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a;
    return hasStartCode ? positive(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff) : null;
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const [b0, b1, b2, b3] = [at(bytes, 21), at(bytes, 22), at(bytes, 23), at(bytes, 24)];
    const width = 1 + (((b1 & 0x3f) << 8) | b0);
    const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    return { width, height };
  }
  if (chunk === 'VP8X' && bytes.length >= 30)
    return { width: 1 + u24le(bytes, 24), height: 1 + u24le(bytes, 27) };
  return null;
}

/** Start-of-frame markers carry the size; C4 (DHT), C8 (JPG) and CC (DAC) are not frames. */
function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function jpegSize(bytes: Uint8Array): Size | null {
  for (const segment of jpegSegments(bytes)) {
    if (segment.marker === 0xda) return null;
    if (isStartOfFrame(segment.marker) && segment.start + 9 <= bytes.length)
      return positive(u16be(bytes, segment.start + 7), u16be(bytes, segment.start + 5));
  }
  return null;
}

type JpegSegment = {
  readonly marker: number;
  /** Offset of the 0xFF that opens the segment. */
  readonly start: number;
  /** Offset just past the segment (for SOS: where the entropy-coded data begins). */
  readonly end: number;
};

/** The header segments after SOI, up to and including SOS; stops at anything malformed. */
function* jpegSegments(bytes: Uint8Array): Generator<JpegSegment> {
  let offset = 2;
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = at(bytes, offset + 1);
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    const length = u16be(bytes, offset + 2);
    if (length < 2) return;
    const end = offset + 2 + length;
    if (end > bytes.length) return;
    yield { marker, start: offset, end };
    if (marker === 0xda) return;
    offset = end;
  }
}

/** APP0 (JFIF), APP2 (ICC colour) and APP14 (Adobe colour transform) change how pixels look. */
const KEPT_APP_MARKERS: ReadonlySet<number> = new Set([0xe0, 0xe2, 0xee]);

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let orientation: number | null = null;
  let tail = bytes.length;
  for (const segment of jpegSegments(bytes)) {
    const isApp = segment.marker >= 0xe0 && segment.marker <= 0xef;
    if (segment.marker === 0xe1) orientation ??= exifOrientation(bytes, segment);
    const drop = (isApp && !KEPT_APP_MARKERS.has(segment.marker)) || segment.marker === 0xfe;
    if (!drop) parts.push(bytes.subarray(segment.start, segment.end));
    if (segment.marker === 0xda) {
      tail = segment.end;
      break;
    }
  }
  if (tail === bytes.length) return bytes;
  if (orientation !== null && orientation !== 1) {
    // After JFIF's APP0 when there is one: JFIF wants to come first.
    const afterJfif = parts[1]?.[1] === 0xe0 ? 2 : 1;
    parts.splice(afterJfif, 0, orientationSegment(orientation));
  }
  parts.push(bytes.subarray(tail));
  return concat(parts);
}

/** The orientation tag (0x0112) of IFD0 in an APP1 EXIF segment, or null. */
function exifOrientation(bytes: Uint8Array, segment: JpegSegment): number | null {
  const tiff = segment.start + 10;
  if (ascii(bytes, segment.start + 4, 4) !== 'Exif' || tiff + 8 > segment.end) return null;
  const little = ascii(bytes, tiff, 2) === 'II';
  const u16 = (offset: number) => (little ? u16le(bytes, offset) : u16be(bytes, offset));
  const u32 = (offset: number) => (little ? u32le(bytes, offset) : u32be(bytes, offset));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > segment.end) return null;
  const count = u16(ifd);
  for (let entry = 0; entry < count; entry += 1) {
    const offset = ifd + 2 + entry * 12;
    if (offset + 12 > segment.end) return null;
    if (u16(offset) === 0x0112) {
      const value = u16(offset + 8);
      return value >= 1 && value <= 8 ? value : null;
    }
  }
  return null;
}

/** A minimal big-endian EXIF APP1 holding only the orientation. */
function orientationSegment(orientation: number): Uint8Array {
  // prettier-ignore
  return Uint8Array.from([
    0xff, 0xe1, 0x00, 0x22, // APP1, length 34
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF, big-endian, IFD0 at 8
    0x00, 0x01, // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // SHORT
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
}

const DROPPED_PNG_CHUNKS: ReadonlySet<string> = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const end = offset + 12 + u32be(bytes, offset);
    if (end > bytes.length) return bytes;
    const kind = ascii(bytes, offset + 4, 4);
    if (!DROPPED_PNG_CHUNKS.has(kind)) parts.push(bytes.subarray(offset, end));
    offset = end;
    if (kind === 'IEND') return concat(parts);
  }
  return bytes;
}

function looksLikeSvg(bytes: Uint8Array): boolean {
  const head = new TextDecoder().decode(bytes.subarray(0, 1024)).trimStart().toLowerCase();
  return head.startsWith('<') && head.includes('<svg');
}

function positive(width: number, height: number): Size | null {
  return width > 0 && height > 0 ? { width, height } : null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function at(bytes: Uint8Array, offset: number): number {
  return bytes[offset] ?? 0;
}

function u16be(bytes: Uint8Array, offset: number): number {
  return (at(bytes, offset) << 8) | at(bytes, offset + 1);
}

function u16le(bytes: Uint8Array, offset: number): number {
  return at(bytes, offset) | (at(bytes, offset + 1) << 8);
}

function u24le(bytes: Uint8Array, offset: number): number {
  return at(bytes, offset) | (at(bytes, offset + 1) << 8) | (at(bytes, offset + 2) << 16);
}

function u32be(bytes: Uint8Array, offset: number): number {
  return u16be(bytes, offset) * 0x10000 + u16be(bytes, offset + 2);
}

function u32le(bytes: Uint8Array, offset: number): number {
  return u16le(bytes, offset) + u16le(bytes, offset + 2) * 0x10000;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function assertNever(value: never): never {
  throw new Error(`unexpected value: ${String(value)}`);
}
