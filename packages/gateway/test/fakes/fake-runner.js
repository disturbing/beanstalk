// A stand-in for the runner container's §3 API (packages/runner), as a Durable Object the
// RUNNER binding points at in tests. Every squash and revert is clean, every suite green,
// every ref update accepted; each request body is kept so tests can inspect what the
// gateway sent.
import { DurableObject } from 'cloudflare:workers';

async function sha1(text) {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class FakeRunner extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__requests')
      return Response.json((await this.ctx.storage.get('requests')) ?? []);
    // The wire contract it implements (RUNNER_API_VERSION in src/runner/runner-transport.ts).
    if (url.pathname === '/version')
      return Response.json({ version: 'fake', api_version: 4, git_sha: 'fake' });
    const body = await request.json();
    const requests = (await this.ctx.storage.get('requests')) ?? [];
    requests.push({ path: url.pathname, body });
    await this.ctx.storage.put('requests', requests);
    return Response.json(await answer(this, url.pathname, body), {
      status: url.pathname.startsWith('/v1/') ? 200 : 404,
    });
  }
}

async function answer(this_, path, body) {
  switch (path) {
    case '/v1/squash': {
      // A bean whose ref names `conflict` conflicts with the line once (then merges).
      if (
        body.change.ref.includes('conflict') &&
        (await firstTime(this_, `conflict:${body.change.ref}`))
      )
        return {
          result: 'conflict',
          files: ['src/shared.ts'],
          merge_base: body.change.base ?? body.onto,
          hunks: [
            {
              path: 'src/shared.ts',
              onto: 'export const total = 1;\n',
              change: 'export const total = 2;\n',
            },
          ],
        };
      const sha = await sha1(`${body.onto}:${body.change.ref}:${body.message}`);
      const files = [`src/${body.change.ref.split('/').at(-1)}.ts`];
      SQUASHED.set(sha, body.change.ref);
      return {
        result: 'clean',
        sha,
        files,
        change_head: sha,
        merge_base: body.change.base ?? body.onto,
        ...(body.change.base === undefined ? {} : { change_files: files }),
      };
    }
    case '/v1/revert': {
      const sha = await sha1(`${body.onto}:revert:${body.commit}`);
      return { result: 'clean', sha, files: ['src/reverted.ts'] };
    }
    case '/v1/check': {
      const extra = Object.keys(body.extra_files ?? {});
      // The first check of a squash of a bean whose ref names `red` fails (its next push passes).
      const squashed = SQUASHED.get(body.sha) ?? '';
      if (squashed.includes('red') && (await firstTime(this_, `red:${squashed}`)))
        return redCheck(body.sha, [squashed, ...SQUASHED.values()].map(beanFile));
      return {
        sha: body.sha,
        green: true,
        tests: 1 + extra.length,
        failures: 0,
        failing_tests: [],
        failing_files: [],
        passing_files: extra,
        read_set: [],
        read_sets: {},
        read_depths: {},
        stack_files: [],
        output_excerpt: '',
        suite_seconds: 0.05,
        ci_seconds: 0.05,
        timed_out: false,
      };
    }
    case '/v1/update-ref':
      return { ok: true, actual: body.new };
    default:
      return { code: 'not_found', message: path };
  }
}

// Runner instances are separate objects (committer, sandboxes, CI) in one isolate: what one
// squashed and which first failures were served are shared here, as one repo would share them.
const SQUASHED = new Map();
const SEEN = new Set();

async function firstTime(_runner, key) {
  if (SEEN.has(key)) return false;
  SEEN.add(key);
  return true;
}

function beanFile(ref) {
  return `src/${ref.split('/').at(-1)}.ts`;
}

/** A red suite whose failing test reads the bean's own file and every file squashed before. */
function redCheck(sha, readSet) {
  return {
    sha,
    green: false,
    tests: 3,
    failures: 1,
    failing_tests: [
      { file: 'test/total.test.js', name: 'total adds tax', message: 'expected 110, got 100' },
    ],
    failing_files: ['test/total.test.js'],
    passing_files: [],
    read_set: [...new Set(readSet)],
    read_sets: { 'test/total.test.js': [...new Set(readSet)] },
    read_depths: {},
    stack_files: [],
    output_excerpt: 'not ok 1 - total adds tax\n  expected 110, got 100',
    suite_seconds: 0.05,
    ci_seconds: 0.05,
    timed_out: false,
  };
}
