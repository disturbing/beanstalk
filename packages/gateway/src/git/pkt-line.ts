/**
 * Git's pkt-line framing (`gitprotocol-common`): a four-hex-digit length that counts itself,
 * then the payload; `0000` is a flush, `0001` a delimiter, `0002` a response end. Side-band
 * packets carry a band byte first: 1 data, 2 progress (`remote:` lines), 3 a fatal error.
 */

/** Largest payload of one pkt-line (65520 bytes in all, minus the length). */
export const MAX_PKT_PAYLOAD = 65_516;
/** Largest side-band-64k chunk: one pkt-line minus the band byte. */
const MAX_SIDEBAND_CHUNK = MAX_PKT_PAYLOAD - 1;

export const FLUSH_PKT: Uint8Array = new TextEncoder().encode('0000');

/** One parsed pkt-line: its payload, or a special packet. */
export type PktLine =
  | { readonly kind: 'data'; readonly payload: Uint8Array }
  | { readonly kind: 'flush' | 'delim' | 'end' };

export type PktParse =
  | { readonly ok: true; readonly lines: readonly PktLine[]; readonly offset: number }
  | { readonly ok: false; readonly reason: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One pkt-line holding `payload` (text is UTF-8 encoded). */
export function pktLine(payload: string | Uint8Array): Uint8Array {
  const bytes = typeof payload === 'string' ? encoder.encode(payload) : payload;
  if (bytes.length > MAX_PKT_PAYLOAD) throw new RangeError('pkt-line payload too long');
  const out = new Uint8Array(bytes.length + 4);
  out.set(encoder.encode((bytes.length + 4).toString(16).padStart(4, '0')), 0);
  out.set(bytes, 4);
  return out;
}

/**
 * Parses whole pkt-lines from `bytes` starting at `offset`, up to the end of the complete lines
 * or, with `stopAtFlush`, just after the first flush. `offset` is where parsing stopped.
 */
export function readPktLines(
  bytes: Uint8Array,
  options: { offset?: number; stopAtFlush?: boolean } = {},
): PktParse {
  const lines: PktLine[] = [];
  let offset = options.offset ?? 0;
  while (offset + 4 <= bytes.length) {
    const lengthText = decoder.decode(bytes.subarray(offset, offset + 4));
    if (!/^[0-9a-fA-F]{4}$/.test(lengthText))
      return { ok: false, reason: 'malformed pkt-line length' };
    const length = Number.parseInt(lengthText, 16);
    if (length < 4) {
      const special = SPECIAL[length];
      if (special === undefined)
        return { ok: false, reason: `unexpected pkt-line length ${length}` };
      lines.push({ kind: special });
      offset += 4;
      if (special === 'flush' && options.stopAtFlush === true) return { ok: true, lines, offset };
      continue;
    }
    if (offset + length > bytes.length) break;
    lines.push({ kind: 'data', payload: bytes.subarray(offset + 4, offset + length) });
    offset += length;
  }
  return { ok: true, lines, offset };
}

const SPECIAL: Readonly<Partial<Record<number, 'flush' | 'delim' | 'end'>>> = {
  0: 'flush',
  1: 'delim',
  2: 'end',
};

const SPECIAL_BYTES: Readonly<Record<'flush' | 'delim' | 'end', string>> = {
  flush: '0000',
  delim: '0001',
  end: '0002',
};

/** A parsed pkt-line written back as bytes. */
export function encodePktLine(line: PktLine): Uint8Array {
  return line.kind === 'data' ? pktLine(line.payload) : encoder.encode(SPECIAL_BYTES[line.kind]);
}

/** A pkt-line's payload as text without its trailing newline. */
export function pktText(payload: Uint8Array): string {
  const text = decoder.decode(payload);
  return text.endsWith('\n') ? text.slice(0, -1) : text;
}

/** Side-band packets of `bytes` on `band`, chunked to fit side-band-64k. */
export function sidebandPackets(band: 1 | 2 | 3, bytes: Uint8Array): Uint8Array {
  const packets: Uint8Array[] = [];
  for (let start = 0; start < bytes.length; start += MAX_SIDEBAND_CHUNK) {
    const chunk = bytes.subarray(start, start + MAX_SIDEBAND_CHUNK);
    const payload = new Uint8Array(chunk.length + 1);
    payload[0] = band;
    payload.set(chunk, 1);
    packets.push(pktLine(payload));
  }
  return concatBytes(packets);
}

/** `remote:` lines: progress on band 2, one packet per line (git prefixes each with `remote:`). */
export function remoteLines(lines: readonly string[]): Uint8Array {
  return concatBytes(lines.map((line) => sidebandPackets(2, encoder.encode(`${line}\n`))));
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
