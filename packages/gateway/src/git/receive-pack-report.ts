/**
 * The response side of `git-receive-pack` for the git-native flow: reading the upstream's
 * report-status (did each ref update?), adding the gateway's own `remote:` lines to it, and
 * writing a whole response for a push the gateway refuses itself, so git prints
 * `! [remote rejected] <ref> (<reason>)` and the gateway's lines instead of an HTTP error.
 */
import {
  FLUSH_PKT,
  concatBytes,
  pktLine,
  pktText,
  readPktLines,
  remoteLines,
  sidebandPackets,
} from './pkt-line';

/** How the client asked to be answered (its capabilities on the first command). */
export type ReportMode = {
  /** `side-band-64k` (or `side-band`): the report travels on band 1 and `remote:` lines on band 2. */
  readonly sideband: boolean;
  readonly reportStatus: boolean;
};

/** One ref's outcome in a report-status. */
export type RefStatus = {
  readonly ref: string;
  readonly ok: boolean;
  readonly reason: string | null;
};

export type ReportStatus = { readonly unpackOk: boolean; readonly refs: readonly RefStatus[] };

export function reportMode(capabilities: readonly string[]): ReportMode {
  return {
    sideband: capabilities.includes('side-band-64k') || capabilities.includes('side-band'),
    reportStatus:
      capabilities.includes('report-status') || capabilities.includes('report-status-v2'),
  };
}

/**
 * The report-status inside a receive-pack response (demultiplexed from band 1 when the push
 * used a side band); null when the response carries none.
 */
export function parseReportStatus(response: Uint8Array, mode: ReportMode): ReportStatus | null {
  const report = mode.sideband ? bandData(response, 1) : response;
  if (report === null) return null;
  const parsed = readPktLines(report);
  if (!parsed.ok) return null;
  let unpackOk: boolean | null = null;
  const refs: RefStatus[] = [];
  for (const line of parsed.lines) {
    if (line.kind !== 'data') continue;
    const text = pktText(line.payload);
    if (text.startsWith('unpack ')) unpackOk = text === 'unpack ok';
    else if (text.startsWith('ok ')) refs.push({ ref: text.slice(3), ok: true, reason: null });
    else if (text.startsWith('ng ')) {
      const [ref = '', ...reason] = text.slice(3).split(' ');
      refs.push({ ref, ok: false, reason: reason.join(' ') });
    }
  }
  return unpackOk === null ? null : { unpackOk, refs };
}

/**
 * The upstream's response with `lines` shown as `remote:` lines just before its final flush.
 * Without a side band there is nowhere to put them, and the response is returned as it was.
 */
export function withRemoteLines(
  response: Uint8Array,
  mode: ReportMode,
  lines: readonly string[],
): Uint8Array {
  if (!mode.sideband || lines.length === 0) return response;
  const body = withoutFinalFlush(response);
  return body === null ? response : concatBytes([body, remoteLines(lines), FLUSH_PKT]);
}

/** The upstream response without its closing flush (so more `remote:` lines may follow). */
export function withoutFinalFlush(response: Uint8Array): Uint8Array | null {
  const tail = new TextDecoder().decode(response.subarray(response.length - 4));
  return tail === '0000' ? response.subarray(0, response.length - 4) : null;
}

/** A full response refusing every ref of a push, with `lines` as `remote:` lines first. */
export function refusalResponse(
  refs: readonly string[],
  reason: string,
  options: { mode: ReportMode; lines: readonly string[] },
): Uint8Array {
  const report = concatBytes([
    pktLine('unpack ok\n'),
    ...refs.map((ref) => pktLine(`ng ${ref} ${oneLine(reason)}\n`)),
    FLUSH_PKT,
  ]);
  if (!options.mode.sideband) return options.mode.reportStatus ? report : new Uint8Array(0);
  const parts = [remoteLines(options.lines)];
  if (options.mode.reportStatus) parts.push(sidebandPackets(1, report));
  parts.push(FLUSH_PKT);
  return concatBytes(parts);
}

/**
 * A whole response accepting `ref` without the repository (a wait ref, which stores nothing):
 * the report on band 1 and its closing flush, so `remote:` lines can be added before the end.
 */
export function acceptedResponse(ref: string, mode: ReportMode): Uint8Array {
  const report = concatBytes([pktLine('unpack ok\n'), pktLine(`ok ${ref}\n`), FLUSH_PKT]);
  if (!mode.sideband) return mode.reportStatus ? report : new Uint8Array(0);
  const parts = mode.reportStatus ? [sidebandPackets(1, report)] : [];
  return concatBytes([...parts, FLUSH_PKT]);
}

function oneLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim().slice(0, 300);
}

/** The bytes of one side band, joined, from a side-band response; null if it is malformed. */
function bandData(response: Uint8Array, band: number): Uint8Array | null {
  const parsed = readPktLines(response);
  if (!parsed.ok) return null;
  const chunks = parsed.lines.flatMap((line) =>
    line.kind === 'data' && line.payload[0] === band ? [line.payload.subarray(1)] : [],
  );
  return concatBytes(chunks);
}
