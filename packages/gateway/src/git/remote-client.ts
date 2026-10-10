/**
 * The gateway as a git client of an Artifacts repo, for the refs it writes itself (status
 * tags, the first sprout and stalk of a repository): read the advertised refs, push ref
 * updates with a small pack. Over smart HTTP with a write token the gateway minted; the token
 * never leaves this module's requests.
 */
import { UpstreamError } from '../errors';
import type { GitObject } from './pack-writer';
import { buildPack } from './pack-writer';
import { FLUSH_PKT, concatBytes, pktLine, pktText, readPktLines } from './pkt-line';
import type { ReportStatus } from './receive-pack-report';
import { parseReportStatus } from './receive-pack-report';

const TIMEOUT_MS = 30_000;
/** Git servers expect a git user agent; this one says who is asking. */
const USER_AGENT = 'git/gitstalk-gateway';
export const ZERO_SHA = '0'.repeat(40);

export type RemoteTarget = { readonly remote: string; readonly token: string };
export type RefUpdate = { readonly ref: string; readonly oldSha: string; readonly newSha: string };

/** The refs a receive-pack advertisement lists (ref → sha). */
export async function listRefs(target: RemoteTarget): Promise<ReadonlyMap<string, string>> {
  const response = await fetch(`${target.remote}/info/refs?service=git-receive-pack`, {
    headers: { authorization: `Bearer ${target.token}`, 'user-agent': USER_AGENT },
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new UpstreamError(`listing refs answered ${response.status}`, response.status >= 500);
  }
  return parseAdvertisedRefs(new Uint8Array(await response.arrayBuffer()));
}

/** Ref → sha from a v0 ref advertisement (the `# service=` header and `capabilities^{}` skipped). */
export function parseAdvertisedRefs(bytes: Uint8Array): ReadonlyMap<string, string> {
  const refs = new Map<string, string>();
  const parsed = readPktLines(bytes);
  if (!parsed.ok) return refs;
  for (const line of parsed.lines) {
    if (line.kind !== 'data') continue;
    const text = pktText(line.payload).split('\0')[0] ?? '';
    const [sha, ref] = text.split(' ');
    if (sha === undefined || ref === undefined || !/^[0-9a-f]{40}$/.test(sha)) continue;
    if (ref !== 'capabilities^{}') refs.set(ref, sha);
  }
  return refs;
}

/** Pushes `updates` with `objects` in the pack; the report-status says what moved. */
export async function pushRefs(
  target: RemoteTarget,
  updates: readonly RefUpdate[],
  objects: readonly GitObject[],
): Promise<ReportStatus> {
  const commands = updates.map((update, index) =>
    pktLine(
      `${update.oldSha} ${update.newSha} ${update.ref}${index === 0 ? '\0report-status agent=gitstalk' : ''}\n`,
    ),
  );
  const body = concatBytes([...commands, FLUSH_PKT, await buildPack(objects)]);
  const response = await fetch(`${target.remote}/git-receive-pack`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.token}`,
      'content-type': 'application/x-git-receive-pack-request',
      accept: 'application/x-git-receive-pack-result',
      'user-agent': USER_AGENT,
    },
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!response.ok)
    throw new UpstreamError(`pushing refs answered ${response.status}`, response.status >= 500);
  const report = parseReportStatus(bytes, { sideband: false, reportStatus: true });
  if (report === null) throw new UpstreamError('pushing refs: no report-status', true);
  return report;
}
