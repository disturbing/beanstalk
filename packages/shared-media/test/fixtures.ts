/**
 * Image headers built byte by byte. The library reads only headers and segment structure, so
 * these carry real signatures, sizes and metadata blocks with stand-in pixel data.
 */

export function png(
  width: number,
  height: number,
  extra: readonly { readonly kind: string; readonly data: string }[] = [],
): Uint8Array {
  const ihdr = [...u32be(width), ...u32be(height), 8, 2, 0, 0, 0];
  return bytes(
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    chunk('IHDR', ihdr),
    ...extra.map((entry) => chunk(entry.kind, ascii(entry.data))),
    chunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01]),
    chunk('IEND', []),
  );
}

export function gif(width: number, height: number): Uint8Array {
  return bytes(ascii('GIF89a'), u16le(width), u16le(height), [0, 0, 0], [0x3b]);
}

export function webpExtended(width: number, height: number): Uint8Array {
  const body = [
    ...ascii('VP8X'),
    ...u32le(10),
    0,
    0,
    0,
    0,
    ...u24le(width - 1),
    ...u24le(height - 1),
  ];
  return bytes(ascii('RIFF'), u32le(4 + body.length), ascii('WEBP'), body);
}

export function webpLossless(width: number, height: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  const bits = [w & 0xff, ((w >> 8) & 0x3f) | ((h & 0x3) << 6), (h >> 2) & 0xff, (h >> 10) & 0x0f];
  const body = [...ascii('VP8L'), ...u32le(5), 0x2f, ...bits, 0, 0, 0, 0];
  return bytes(ascii('RIFF'), u32le(4 + body.length), ascii('WEBP'), body);
}

export function webpLossy(width: number, height: number): Uint8Array {
  const body = [
    ...ascii('VP8 '),
    ...u32le(10),
    0,
    0,
    0,
    0x9d,
    0x01,
    0x2a,
    ...u16le(width),
    ...u16le(height),
  ];
  return bytes(ascii('RIFF'), u32le(4 + body.length), ascii('WEBP'), body);
}

/** A JPEG with JFIF, optional EXIF (orientation and a GPS marker string), a comment, SOF0, SOS. */
export function jpeg(
  width: number,
  height: number,
  options: { readonly orientation?: number; readonly gps?: string } = {},
): Uint8Array {
  const jfif = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  const exif =
    options.orientation === undefined && options.gps === undefined
      ? []
      : segment(0xe1, exifBody(options.orientation ?? 1, options.gps ?? ''));
  const comment = segment(0xfe, ascii('made on my phone'));
  const sof = segment(0xc0, [8, ...u16be(height), ...u16be(width), 1, 1, 0x11, 0]);
  const sos = segment(0xda, [1, 1, 0, 0, 0x3f, 0]);
  return bytes([0xff, 0xd8], jfif, exif, comment, sof, sos, [0x12, 0x34, 0x56], [0xff, 0xd9]);
}

/** Little-endian TIFF with the orientation in IFD0 and an opaque string after it. */
function exifBody(orientation: number, gps: string): number[] {
  const ifd = [
    ...u16le(1),
    ...u16le(0x0112),
    ...u16le(3),
    ...u32le(1),
    ...u16le(orientation),
    0,
    0,
    ...u32le(0),
  ];
  return [...ascii('Exif'), 0, 0, ...ascii('II'), 0x2a, 0, ...u32le(8), ...ifd, ...ascii(gps)];
}

function segment(marker: number, body: readonly number[]): number[] {
  return [0xff, marker, ...u16be(body.length + 2), ...body];
}

function chunk(kind: string, data: readonly number[]): number[] {
  // The CRC is not checked by the library; a fixed value keeps the fixture simple.
  return [...u32be(data.length), ...ascii(kind), ...data, 0, 0, 0, 0];
}

export function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

export function includesText(haystack: Uint8Array, text: string): boolean {
  return new TextDecoder('latin1').decode(haystack).includes(text);
}

function bytes(...parts: readonly (readonly number[])[]): Uint8Array {
  return Uint8Array.from(parts.flat());
}

function u16be(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}
function u16le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}
function u24le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];
}
function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}
function u32le(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}
