import { describe, expect, it } from 'vitest';

import { accessFor, parseGitPath } from './git-path';
import { inspectPush, parseCommands, pushRefusal } from './receive-pack';

const OLD = '0'.repeat(40);
const NEW = 'a'.repeat(40);

/** One pkt-line: four hex digits of length (including themselves), then the payload. */
function pkt(line: string): string {
  return `${(line.length + 4).toString(16).padStart(4, '0')}${line}`;
}

function streamOf(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe('receive-pack command list', () => {
  it('parses commands up to the flush, ignoring capabilities and shallow lines', () => {
    const body = `${pkt(`shallow ${NEW}\n`)}${pkt(`${OLD} ${NEW} refs/heads/task/t001\0report-status side-band-64k\n`)}${pkt(`${NEW} ${OLD} refs/heads/x\n`)}0000PACK`;

    expect(parseCommands(new TextEncoder().encode(body))).toEqual({
      commands: [
        { oldSha: OLD, newSha: NEW, ref: 'refs/heads/task/t001' },
        { oldSha: NEW, newSha: OLD, ref: 'refs/heads/x' },
      ],
      complete: true,
    });
  });

  it('replays every byte it read, then the rest of the stream, untouched', async () => {
    const commands = `${pkt(`${OLD} ${NEW} refs/heads/task/t001\0report-status\n`)}0000`;
    const inspection = await inspectPush(
      streamOf(commands.slice(0, 7), commands.slice(7), 'PACK', 'BINARY-REST'),
    );

    expect(inspection.ok).toBe(true);
    if (!inspection.ok) return;
    expect(inspection.commands).toEqual([
      { oldSha: OLD, newSha: NEW, ref: 'refs/heads/task/t001' },
    ]);
    expect(await new Response(inspection.body).text()).toBe(`${commands}PACKBINARY-REST`);
  });

  it('accepts the flush-only probe git sends before a large push', async () => {
    const inspection = await inspectPush(streamOf('0000'));

    expect(inspection).toMatchObject({ ok: true, commands: [] });
  });

  it('refuses a body that ends inside the command list, and signed pushes', async () => {
    expect(await inspectPush(streamOf(pkt(`${OLD} ${NEW} refs/heads/x\n`)))).toMatchObject({
      ok: false,
    });
    expect(await inspectPush(streamOf(`${pkt('push-cert\0x\n')}0000`))).toMatchObject({
      ok: false,
    });
  });

  it('allows only the granted refs and never a deletion', () => {
    const update = { oldSha: OLD, newSha: NEW, ref: 'refs/heads/task/t001' };

    expect(pushRefusal([update], ['refs/heads/task/t001'])).toBeNull();
    expect(pushRefusal([{ ...update, ref: 'refs/heads/main' }], ['refs/heads/task/t001'])).toMatch(
      /not allowed/,
    );
    expect(pushRefusal([{ ...update, newSha: OLD }], ['refs/heads/task/t001'])).toMatch(/deleting/);
  });
});

const url = (path: string): URL => new URL(`https://gw.test${path}`);

describe('git paths', () => {
  it('recognises the smart-HTTP endpoints and the access they need', () => {
    const advert = parseGitPath(
      url('/git/beanstalk-race/race-abc123def4-t001.git/info/refs?service=git-receive-pack'),
      'GET',
    );
    const upload = parseGitPath(
      url('/git/beanstalk-race/race-abc123def4.git/git-upload-pack'),
      'POST',
    );

    expect(advert).toMatchObject({
      ok: true,
      path: { repo: 'race-abc123def4-t001', service: 'git-receive-pack', rest: 'info/refs' },
    });
    expect(upload).toMatchObject({
      ok: true,
      path: { service: 'git-upload-pack', rest: 'git-upload-pack' },
    });
    expect(accessFor('git-receive-pack')).toBe('write');
    expect(accessFor('git-upload-pack')).toBe('read');
  });

  it('refuses the dumb protocol and wrong methods', () => {
    expect(parseGitPath(url('/git/ns/repo.git/info/refs'), 'GET')).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(parseGitPath(url('/git/ns/repo.git/HEAD'), 'GET')).toMatchObject({
      ok: false,
      status: 404,
    });
    expect(parseGitPath(url('/git/ns/repo.git/git-upload-pack'), 'GET')).toMatchObject({
      ok: false,
      status: 405,
    });
  });
});
