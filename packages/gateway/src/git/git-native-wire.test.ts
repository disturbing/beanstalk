import { describe, expect, it } from 'vitest';

import { withCapabilities } from './advertisement';
import { EMPTY_TREE_ID, annotatedTag, buildPack, gitObject } from './pack-writer';
import { FLUSH_PKT, concatBytes, pktLine, readPktLines, remoteLines } from './pkt-line';
import { readPushRequest } from './push-request';
import {
  parseReportStatus,
  refusalResponse,
  reportMode,
  withRemoteLines,
} from './receive-pack-report';
import { parseAdvertisedRefs } from './remote-client';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);

function stream(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream();
}

describe('pack writer', () => {
  it('names objects as git does', async () => {
    expect((await gitObject('blob', 'hello\n')).id).toBe(
      'ce013625030ba8dba906f756967f9e9ca394464a',
    );
    expect((await gitObject('tree', new Uint8Array(0))).id).toBe(EMPTY_TREE_ID);
  });

  it('writes an annotated tag on a commit', async () => {
    const tag = await annotatedTag({
      object: A,
      tag: 'beans/x/status',
      tagger: { name: 'beanstalk', email: 'engine@beanstalk.invalid', atMs: 1_700_000_000_000 },
      message: 'landed: on the sprout',
    });
    expect(decoder.decode(tag.body)).toBe(
      `object ${A}\ntype commit\ntag beans/x/status\ntagger beanstalk <engine@beanstalk.invalid> 1700000000 +0000\n\nlanded: on the sprout\n`,
    );
  });

  it('writes a version 2 pack with its object count and a SHA-1 trailer', async () => {
    const blob = await gitObject('blob', 'x'.repeat(300));
    const pack = await buildPack([blob]);
    expect(decoder.decode(pack.subarray(0, 4))).toBe('PACK');
    expect(new DataView(pack.buffer).getUint32(4)).toBe(2);
    expect(new DataView(pack.buffer).getUint32(8)).toBe(1);
    // A blob of 300 bytes: type 3, size continued into a second header byte.
    expect(pack[12]).toBe(0x80 | (3 << 4) | (300 & 0x0f));
    expect(pack[13]).toBe(300 >> 4);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', pack.subarray(0, -20)));
    expect([...pack.subarray(-20)]).toEqual([...digest]);
  });
});

describe('push requests', () => {
  it('reads commands and push options, and forwards neither the options nor their capability', async () => {
    const body =
      `${decoder.decode(pktLine(`${A} ${B} refs/heads/bean/x\0report-status side-band-64k push-options agent=git/2\n`))}0000` +
      `${decoder.decode(pktLine('wait\n'))}${decoder.decode(pktLine('task=T-1\n'))}0000PACKDATA`;
    const read = await readPushRequest(stream(body));
    if (!read.ok) throw new Error(read.reason);
    expect(read.request.commands).toEqual([{ oldSha: A, newSha: B, ref: 'refs/heads/bean/x' }]);
    expect(read.request.options).toEqual(['wait', 'task=T-1']);
    expect(read.request.capabilities).toContain('side-band-64k');
    const forwarded = await new Response(read.request.upstreamBody).text();
    expect(forwarded).toBe(
      `${decoder.decode(pktLine(`${A} ${B} refs/heads/bean/x\0report-status side-band-64k agent=git/2\n`))}0000PACKDATA`,
    );
  });

  it('passes a push without options through byte for byte', async () => {
    const body = `${decoder.decode(pktLine(`${A} ${B} refs/heads/bean/x\0report-status\n`))}0000PACK`;
    const read = await readPushRequest(stream(body));
    if (!read.ok) throw new Error(read.reason);
    expect(read.request.options).toEqual([]);
    expect(await new Response(read.request.upstreamBody).text()).toBe(body);
  });

  it('refuses a malformed command list', async () => {
    const read = await readPushRequest(stream(`${decoder.decode(pktLine('nonsense\n'))}0000`));
    expect(read).toEqual({ ok: false, reason: 'malformed push command' });
  });
});

describe('advertisements and reports', () => {
  const advert = concatBytes([
    pktLine('# service=git-receive-pack\n'),
    FLUSH_PKT,
    pktLine(`${A} refs/heads/sprout\0report-status side-band-64k\n`),
    pktLine(`${A} refs/heads/stalk\n`),
    FLUSH_PKT,
  ]);

  it('adds push-options to the first ref line once', () => {
    const once = withCapabilities(advert, ['push-options']);
    const twice = withCapabilities(once, ['push-options']);
    expect(decoder.decode(twice)).toContain('report-status side-band-64k push-options\n');
    expect(twice).toEqual(once);
    expect(parseAdvertisedRefs(once)).toEqual(
      new Map([
        ['refs/heads/sprout', A],
        ['refs/heads/stalk', A],
      ]),
    );
  });

  it('reads a side-band report and adds remote lines before its final flush', () => {
    const report = concatBytes([
      pktLine('unpack ok\n'),
      pktLine('ok refs/heads/bean/x\n'),
      FLUSH_PKT,
    ]);
    const banded = concatBytes([pktLine(concatBytes([Uint8Array.of(1), report])), FLUSH_PKT]);
    const mode = reportMode(['report-status', 'side-band-64k']);
    expect(parseReportStatus(banded, mode)).toEqual({
      unpackOk: true,
      refs: [{ ref: 'refs/heads/bean/x', ok: true, reason: null }],
    });
    const withLines = withRemoteLines(banded, mode, ['beanstalk: hello']);
    expect(decoder.decode(withLines)).toBe(
      `${decoder.decode(banded.subarray(0, -4))}${decoder.decode(remoteLines(['beanstalk: hello']))}0000`,
    );
  });

  it('writes a refusal git prints as a remote rejection', () => {
    const mode = reportMode(['report-status', 'side-band-64k']);
    const bytes = refusalResponse(['refs/heads/sprout'], 'landing is never a push', {
      mode,
      lines: ['beanstalk: push refused'],
    });
    const lines = readPktLines(bytes);
    if (!lines.ok) throw new Error(lines.reason);
    const report = parseReportStatus(bytes, mode);
    expect(report?.refs).toEqual([
      { ref: 'refs/heads/sprout', ok: false, reason: 'landing is never a push' },
    ]);
    expect(decoder.decode(bytes)).toContain('\u0002beanstalk: push refused\n');
    expect(encoder.encode(decoder.decode(bytes.subarray(-4)))).toEqual(FLUSH_PKT);
  });
});
