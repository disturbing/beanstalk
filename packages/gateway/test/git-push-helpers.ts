import { env } from 'cloudflare:test';
import { expect } from 'vitest';

import { ADMIN, call, json, pkt } from './helpers';

/**
 * Git's side of the git-native flow for tests: a repository engine opened through the admin
 * API, push bodies as `git push` sends them (commands, push options, then the pack, here a JSON
 * payload the fake remote reads as commits), and the side-band response read as git reads it,
 * whole or as it streams.
 */

export const GIT_UA = { 'user-agent': 'git/2.47.0' };
export const ZERO = '0'.repeat(40);

export type Opened = { engineId: string; created: boolean; base_sha: string; git_path: string };
export type Bean = {
  bean: string;
  phase: string;
  reason: string;
  task: string | null;
  pushes: number;
  verdict: string[];
};

export async function openRepo(
  repo: string,
  engine?: Record<string, unknown>,
): Promise<{ opened: Opened; token: string }> {
  const response = await call('POST', '/v1/repos', {
    token: ADMIN,
    body: {
      repoName: repo,
      artifactsRepo: `repo-${repo}`,
      owner: { id: 'u1', handle: 'acme' },
      settings: {
        bean_url: 'https://web.test/acme/beans/{bean}',
        // The fake runner decides these tests' reds; the repository's own checks are below.
        engine: { checks_source: 'suite', ...engine },
      },
      create_artifacts_repo: true,
    },
  });
  expect(response.status).toBe(201);
  const opened = await json<Opened>(response);
  const minted = await call('POST', `/v1/repos/${opened.engineId}/git-token`, {
    token: ADMIN,
    body: { user: { id: 'u1', handle: 'coop' } },
  });
  return { opened, token: (await json<{ token: string }>(minted)).token };
}

/** What `git push` sends: one command with capabilities, push options, then the pack. */
export function pushBody(input: {
  ref: string;
  oldSha?: string;
  newSha: string;
  options?: string[];
  message?: string;
}): string {
  const options = input.options ?? [];
  const caps = `report-status side-band-64k${options.length > 0 ? ' push-options' : ''} agent=git/2.47.0`;
  const command = pkt(`${input.oldSha ?? ZERO} ${input.newSha} ${input.ref}\0${caps}\n`);
  const optionSection =
    options.length > 0 ? `${options.map((option) => pkt(`${option}\n`)).join('')}0000` : '';
  const commits =
    input.newSha === ZERO
      ? {}
      : { [input.newSha]: { message: input.message ?? 'Change', parents: [], files: {} } };
  return `${command}0000${optionSection}PACK${JSON.stringify({ commits })}`;
}

export function push(path: string, token: string, body: string): Promise<Response> {
  return call('POST', `${path}/git-receive-pack`, {
    body,
    headers: {
      ...GIT_UA,
      authorization: `Basic ${btoa(`x:${token}`)}`,
      'content-type': 'application/x-git-receive-pack-request',
      accept: 'application/x-git-receive-pack-result',
    },
  });
}

export type GitOutput = { remote: string; report: string };

/** The side-band response as git reads it: `remote:` lines (band 2) and the report (band 1). */
export async function gitResponse(response: Response): Promise<GitOutput> {
  return demux(await response.text()).output;
}

/** A streamed push response read as it arrives: wait for a line, then read the rest. */
export class GitStream {
  readonly #reader: ReadableStreamDefaultReader<Uint8Array>;
  readonly #decoder = new TextDecoder();
  #text = '';

  constructor(response: Response) {
    if (response.body === null) throw new Error('no response body');
    this.#reader = response.body.getReader();
  }

  /** Reads until the `remote:` output contains `text`; what was read so far. */
  async until(text: string): Promise<GitOutput> {
    for (;;) {
      const output = demux(this.#text).output;
      if (output.remote.includes(text)) return output;
      // oxlint-disable-next-line no-await-in-loop -- the stream is read chunk by chunk
      const { done, value } = await this.#reader.read();
      if (done) throw new Error(`the response ended without "${text}":\n${output.remote}`);
      this.#text += this.#decoder.decode(value, { stream: true });
    }
  }

  /** Reads to the end; everything the response carried. */
  async rest(): Promise<GitOutput> {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- the stream is read chunk by chunk
      const { done, value } = await this.#reader.read();
      if (done) return demux(this.#text).output;
      this.#text += this.#decoder.decode(value, { stream: true });
    }
  }
}

function demux(text: string): { output: GitOutput } {
  let remote = '';
  let report = '';
  let offset = 0;
  while (offset + 4 <= text.length) {
    const length = Number.parseInt(text.slice(offset, offset + 4), 16);
    if (length === 0) {
      offset += 4;
      continue;
    }
    if (offset + length > text.length) break;
    const payload = text.slice(offset + 5, offset + length);
    if (text.charCodeAt(offset + 4) === 2) remote += payload;
    else if (text.charCodeAt(offset + 4) === 1) report += payload;
    offset += length;
  }
  return { output: { remote, report } };
}

export async function beans(engine: string): Promise<Bean[]> {
  return json<Bean[]>(await call('GET', `/v1/repos/${engine}/beans`, { token: ADMIN }));
}

/** Asks for the beans until `bean` reaches one of `phases` (the engine works between asks). */
export async function until(
  engine: string,
  bean: string,
  phases: readonly string[],
): Promise<Bean> {
  for (let ask = 0; ask < 400; ask += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the engine moves between asks
    const found = (await beans(engine)).find((candidate) => candidate.bean === bean);
    if (found !== undefined && phases.includes(found.phase)) return found;
  }
  throw new Error(`${bean} never reached ${phases.join(' or ')}`);
}

export async function advertisedRefs(path: string, token: string): Promise<string> {
  const response = await call('GET', `${path}/info/refs?service=git-upload-pack`, {
    headers: { ...GIT_UA, authorization: `Basic ${btoa(`x:${token}`)}` },
  });
  return response.text();
}

/** Lets the fake runner finish the check of a bean named `held-*` (it holds until then). */
export async function release(bean: string): Promise<void> {
  const response = await env.RUNNER.getByName('control').fetch(
    `http://runner/__release?bean=${encodeURIComponent(bean)}`,
  );
  expect(response.status).toBe(200);
}
