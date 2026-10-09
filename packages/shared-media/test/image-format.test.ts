import { describe, expect, it } from 'vitest';

import { sniffImage, stripMetadata } from '../src/image-format';
import {
  ascii,
  gif,
  includesText,
  jpeg,
  png,
  webpExtended,
  webpLossless,
  webpLossy,
} from './fixtures';

describe('sniffImage', () => {
  it.each([
    ['png', png(300, 200), 300, 200],
    ['gif', gif(64, 48), 64, 48],
    ['webp (VP8X)', webpExtended(1200, 630), 1200, 630],
    ['webp (VP8L)', webpLossless(513, 257), 513, 257],
    ['webp (VP8)', webpLossy(640, 320), 640, 320],
    ['jpeg', jpeg(800, 600), 800, 600],
  ])('reads the type and size of a %s from its bytes', (_name, bytes, width, height) => {
    const sniffed = sniffImage(bytes);
    expect(sniffed.ok && sniffed.image).toMatchObject({ width, height });
  });

  it('refuses an SVG by name, even with leading whitespace and a prolog', () => {
    const svg = Uint8Array.from(
      ascii('  <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    );
    expect(sniffImage(svg)).toEqual({ ok: false, reason: 'svg' });
  });

  it('refuses other files whatever they are called', () => {
    expect(sniffImage(Uint8Array.from(ascii('%PDF-1.7 ...')))).toEqual({
      ok: false,
      reason: 'unsupported',
    });
    expect(sniffImage(new Uint8Array())).toEqual({ ok: false, reason: 'unsupported' });
  });

  it('calls a cut-off header corrupt', () => {
    expect(sniffImage(png(10, 10).subarray(0, 18))).toEqual({ ok: false, reason: 'corrupt' });
    expect(sniffImage(jpeg(10, 10).subarray(0, 30))).toEqual({ ok: false, reason: 'corrupt' });
  });
});

describe('stripMetadata', () => {
  it('drops JPEG EXIF and comments but keeps the orientation, so photos stay upright', () => {
    const original = jpeg(800, 600, { orientation: 6, gps: 'GPS 51.5N 0.12W' });
    const stripped = stripMetadata('jpeg', original);
    expect(includesText(stripped, 'GPS 51.5N')).toBe(false);
    expect(includesText(stripped, 'made on my phone')).toBe(false);
    expect(includesText(stripped, 'JFIF')).toBe(true);
    const sniffed = sniffImage(stripped);
    expect(sniffed.ok && sniffed.image).toMatchObject({ width: 800, height: 600 });
    // The new APP1 follows JFIF and holds orientation 6.
    const app1 = stripped.indexOf(0xe1, 20);
    expect(stripped[app1 - 1]).toBe(0xff);
    expect(stripped[app1 + 28]).toBe(6);
  });

  it('writes no EXIF back for an upright photo', () => {
    const stripped = stripMetadata('jpeg', jpeg(100, 100, { orientation: 1, gps: 'GPS here' }));
    expect(includesText(stripped, 'Exif')).toBe(false);
  });

  it('drops PNG text and EXIF chunks and keeps the image chunks', () => {
    const original = png(40, 40, [
      { kind: 'tEXt', data: 'Author\0Somebody Private' },
      { kind: 'eXIf', data: 'MM camera serial' },
    ]);
    const stripped = stripMetadata('png', original);
    expect(includesText(stripped, 'Somebody Private')).toBe(false);
    expect(includesText(stripped, 'camera serial')).toBe(false);
    expect(includesText(stripped, 'IDAT')).toBe(true);
    expect(includesText(stripped, 'IEND')).toBe(true);
  });

  it('leaves WebP and GIF as they are', () => {
    const webp = webpExtended(10, 10);
    expect(stripMetadata('webp', webp)).toBe(webp);
  });
});
