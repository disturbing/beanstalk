import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import type { PoolSnapshot } from '../src/capacity/runner-capacity';
import { ADMIN, call, json, pkt, sha } from './helpers';

/**
 * The git-native flow end to end through the real Worker and engine Durable Object, with the
 * fake Artifacts remote speaking real smart HTTP (advertisement, report-status, side band) and
 * the fake runner (a bean named `red-*` fails its first check, `conflict-*` conflicts once).
 * The bodies are what `git push` sends: commands, push options, then the pack (here a JSON
 * payload the fake remote reads as commits).
 */

const GIT_UA = { 'user-agent': 'git/2.47.0' };
const ZERO = '0'.repeat(40);

type Opened = { engineId: string; created: boolean; base_sha: string; git_path: string };
type Bean = {
  bean: string;
  phase: string;
  reason: string;
  task: string | null;
  pushes: number;
  verdict: string[];
};

async function openRepo(
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
function pushBody(input: {
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

function push(path: string, token: string, body: string): Promise<Response> {
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

/** The side-band response as git reads it: `remote:` lines (band 2) and the report (band 1). */
async function gitResponse(response: Response): Promise<{ remote: string; report: string }> {
  const text = await response.text();
  let remote = '';
  let report = '';
  let offset = 0;
  while (offset + 4 <= text.length) {
    const length = Number.parseInt(text.slice(offset, offset + 4), 16);
    if (length === 0) {
      offset += 4;
      continue;
    }
    const payload = text.slice(offset + 5, offset + length);
    if (text.charCodeAt(offset + 4) === 2) remote += payload;
    else if (text.charCodeAt(offset + 4) === 1) report += payload;
    offset += length;
  }
  return { remote, report };
}

async function beans(engine: string): Promise<Bean[]> {
  return json<Bean[]>(await call('GET', `/v1/repos/${engine}/beans`, { token: ADMIN }));
}

/** Asks for the beans until `bean` reaches one of `phases` (the engine works between asks). */
async function until(engine: string, bean: string, phases: readonly string[]): Promise<Bean> {
  for (let ask = 0; ask < 400; ask += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the engine moves between asks
    const found = (await beans(engine)).find((candidate) => candidate.bean === bean);
    if (found !== undefined && phases.includes(found.phase)) return found;
  }
  throw new Error(`${bean} never reached ${phases.join(' or ')}`);
}

async function advertisedRefs(path: string, token: string): Promise<string> {
  const response = await call('GET', `${path}/info/refs?service=git-upload-pack`, {
    headers: { ...GIT_UA, authorization: `Basic ${btoa(`x:${token}`)}` },
  });
  return response.text();
}

describe('git-native flow', () => {
  it('opens a repository engine once, with the sprout and the stalk at the default branch', async () => {
    const { opened, token } = await openRepo('shop');
    expect(opened.git_path).toBe('/git/acme/shop.git');
    const again = await call('POST', '/v1/repos', {
      token: ADMIN,
      body: { repoName: 'shop', artifactsRepo: 'repo-shop', owner: { id: 'u1', handle: 'acme' } },
    });
    expect(again.status).toBe(200);
    expect(await json(again)).toMatchObject({ engineId: opened.engineId, created: false });
    const refs = await advertisedRefs(opened.git_path, token);
    expect(refs).toContain(`${opened.base_sha} refs/heads/sprout`);
    expect(refs).toContain(`${opened.base_sha} refs/heads/stalk`);
  });

  it('opens an engine on an imported public repository, the lines at its default branch', async () => {
    const response = await call('POST', '/v1/repos', {
      token: ADMIN,
      body: {
        repoName: 'imported',
        artifactsRepo: 'repo-imported',
        owner: { id: 'u1', handle: 'acme' },
        import_url: 'https://git.example.test/acme/base.git',
      },
    });
    expect(response.status).toBe(201);
    const opened = await json<Opened>(response);
    const minted = await call('POST', `/v1/repos/${opened.engineId}/git-token`, {
      token: ADMIN,
      body: { user: { id: 'u1', handle: 'coop' } },
    });
    const { token } = await json<{ token: string }>(minted);
    const refs = await advertisedRefs(opened.git_path, token);
    expect(refs).toContain(`${opened.base_sha} refs/heads/sprout`);
    expect(refs).toContain(`${opened.base_sha} refs/heads/stalk`);
    expect(refs).toContain(`${opened.base_sha} refs/heads/main`);
  });

  it('refuses an import URL that is not https', async () => {
    const response = await call('POST', '/v1/repos', {
      token: ADMIN,
      body: {
        repoName: 'plain',
        artifactsRepo: 'repo-plain',
        owner: { id: 'u1', handle: 'acme' },
        import_url: 'http://git.example.test/acme/base.git',
      },
    });
    expect(response.status).toBe(400);
  });

  it('advertises push options for receive-pack', async () => {
    const { opened, token } = await openRepo('adverts');
    const response = await call('GET', `${opened.git_path}/info/refs?service=git-receive-pack`, {
      headers: { ...GIT_UA, authorization: `Basic ${btoa(`x:${token}`)}` },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toMatch(/report-status side-band-64k.* push-options/);
  });

  it('turns a push into a bean that lands, with remote lines and a status ref', async () => {
    const { opened, token } = await openRepo('landing');
    const head = await sha('landing-1');
    const response = await push(
      opened.git_path,
      token,
      pushBody({
        ref: 'refs/heads/bean/add-total',
        newSha: head,
        message: 'Add a total helper\n\nSums the line items.\n\nTask: T-12',
      }),
    );
    expect(response.status).toBe(200);
    const { remote, report } = await gitResponse(response);
    expect(report).toContain('ok refs/heads/bean/add-total');
    expect(remote).toContain('new bean add-total received');
    expect(remote).toContain('"Add a total helper"');
    expect(remote).toContain('for task T-12');
    expect(remote).toContain('pre-land check started');
    const landed = await until(opened.engineId, 'add-total', ['landed', 'green']);
    expect(landed).toMatchObject({ task: 'T-12', pushes: 1 });
    expect(landed.verdict.join('\n')).toContain('LANDED: add-total');
    expect(await advertisedRefs(opened.git_path, token)).toContain('refs/beans/add-total/status');
  });

  it('holds a push with -o wait and prints the verdict', async () => {
    const { opened, token } = await openRepo('waiting');
    const response = await push(
      opened.git_path,
      token,
      pushBody({ ref: 'refs/heads/bean/wait-one', newSha: await sha('wait-1'), options: ['wait'] }),
    );
    const { remote, report } = await gitResponse(response);
    expect(report).toContain('ok refs/heads/bean/wait-one');
    expect(remote).toContain('LANDED: wait-one passed its pre-land check');
    expect(remote).toContain('web: https://web.test/acme/beans/wait-one');
  });

  it('answers a red push with the failing tests and the fix; the next push lands', async () => {
    const { opened, token } = await openRepo('reds');
    const first = await sha('red-1');
    const red = await gitResponse(
      await push(
        opened.git_path,
        token,
        pushBody({ ref: 'refs/heads/bean/red-total', newSha: first, options: ['wait'] }),
      ),
    );
    expect(red.remote).toContain('RED: red-total was not landed');
    expect(red.remote).toContain('test/total.test.js');
    expect(red.remote).toContain('git fetch origin sprout && git rebase origin/sprout');
    expect((await until(opened.engineId, 'red-total', ['red'])).reason).toContain('failing');

    const fixed = await gitResponse(
      await push(
        opened.git_path,
        token,
        pushBody({
          ref: 'refs/heads/bean/red-total',
          oldSha: first,
          newSha: await sha('red-2'),
          options: ['wait'],
        }),
      ),
    );
    expect(fixed.remote).toContain('bean red-total received');
    expect(fixed.remote).toContain('LANDED: red-total');
  });

  it('names the landed bean a red push collided with, and its intent', async () => {
    const { opened, token } = await openRepo('collisions');
    await push(
      opened.git_path,
      token,
      pushBody({
        ref: 'refs/heads/bean/tax-rate',
        newSha: await sha('tax-1'),
        message: 'Charge 10% tax\n\nEvery total includes a 10% tax line.',
        options: ['wait'],
      }),
    );
    const { remote } = await gitResponse(
      await push(
        opened.git_path,
        token,
        pushBody({
          ref: 'refs/heads/bean/red-discount',
          newSha: await sha('disc-1'),
          options: ['wait'],
        }),
      ),
    );
    expect(remote).toContain('RED: red-discount was not landed');
    expect(remote).toContain('it collided with these landed beans');
    expect(remote).toContain('tax-rate "Charge 10% tax"');
    expect(remote).toContain('intent: Charge 10% tax Every total includes a 10% tax line.');
  });

  it('quotes the hunks of a conflicting push', async () => {
    const { opened, token } = await openRepo('conflicts');
    const { remote } = await gitResponse(
      await push(
        opened.git_path,
        token,
        pushBody({
          ref: 'refs/heads/bean/conflict-total',
          newSha: await sha('c-1'),
          options: ['wait'],
        }),
      ),
    );
    expect(remote).toContain('CONFLICT: conflict-total does not merge onto the sprout');
    expect(remote).toContain('src/shared.ts');
  });

  it('refuses pushes to the lines, other branches, deletions and a landed bean, in the protocol', async () => {
    const { opened, token } = await openRepo('refusals');
    for (const ref of ['refs/heads/sprout', 'refs/heads/stalk', 'refs/heads/main']) {
      // oxlint-disable-next-line no-await-in-loop -- one refusal at a time
      const newSha = await sha(ref);
      // oxlint-disable-next-line no-await-in-loop -- one refusal at a time
      const response = await push(opened.git_path, token, pushBody({ ref, newSha }));
      expect(response.status).toBe(200);
      // oxlint-disable-next-line no-await-in-loop -- read the refusal
      const { remote, report } = await gitResponse(response);
      expect(report).toContain(`ng ${ref} ${ref} is the engine's: landing is never a push`);
      expect(remote).toContain('push refused');
    }
    const feature = await gitResponse(
      await push(
        opened.git_path,
        token,
        pushBody({ ref: 'refs/heads/feature', newSha: await sha('f') }),
      ),
    );
    expect(feature.report).toContain('ng refs/heads/feature only beans are pushed');
    const deletion = await gitResponse(
      await push(
        opened.git_path,
        token,
        pushBody({ ref: 'refs/heads/bean/x', oldSha: await sha('x'), newSha: ZERO }),
      ),
    );
    expect(deletion.report).toContain('deleting refs is not allowed');
    expect(await advertisedRefs(opened.git_path, token)).not.toContain('refs/heads/feature');
    const first = await sha('done-1');
    await push(
      opened.git_path,
      token,
      pushBody({ ref: 'refs/heads/bean/done-one', newSha: first, options: ['wait'] }),
    );
    const again = await gitResponse(
      await push(
        opened.git_path,
        token,
        pushBody({ ref: 'refs/heads/bean/done-one', oldSha: first, newSha: await sha('done-2') }),
      ),
    );
    expect(again.report).toContain('ng refs/heads/bean/done-one bean done-one already landed');
  });

  it('lets a view token clone but not push, and hides the repository from other tokens', async () => {
    const { opened } = await openRepo('access');
    const other = await openRepo('elsewhere');
    const view = await call('POST', `/v1/runs/${opened.engineId}/tokens`, { token: ADMIN });
    expect(view.status).toBeLessThan(500);
    const foreign = await call('GET', `${opened.git_path}/info/refs?service=git-upload-pack`, {
      headers: { ...GIT_UA, authorization: `Basic ${btoa(`x:${other.token}`)}` },
    });
    expect(foreign.status).toBe(404);
    const anonymous = await call('GET', `${opened.git_path}/info/refs?service=git-upload-pack`, {
      headers: GIT_UA,
    });
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers.get('www-authenticate')).toContain('Basic');
  });

  it('closes an engine: pushes are refused and its repo is deleted', async () => {
    const { opened, token } = await openRepo('closing');
    const closed = await call('POST', `/v1/repos/${opened.engineId}/close`, {
      token: ADMIN,
      body: { delete_repo: true },
    });
    expect(closed.status).toBe(200);
    const { report } = await gitResponse(
      await push(
        opened.git_path,
        token,
        pushBody({ ref: 'refs/heads/bean/late', newSha: await sha('late') }),
      ),
    );
    expect(report).toMatch(/ng refs\/heads\/bean\/late the repository engine is (finishing|done)/);
  });
});

/** Suites the fake runner instance ran. */
async function checksOn(instance: string): Promise<number> {
  const requests = await json<{ path: string }[]>(
    await env.RUNNER.getByName(instance).fetch('http://runner/__requests'),
  );
  return requests.filter((request) => request.path === '/v1/check').length;
}

describe('pre-land sandboxes of a repository engine', () => {
  it('checks beans at once, each in a sandbox leased for it, within the cap, and gives them back', async () => {
    const { opened, token } = await openRepo('pool', { preland_sandboxes: 3, ci_slots: 1 });
    const engine = opened.engineId;
    const names = ['p-one', 'p-two', 'p-three', 'p-four', 'p-five'];

    const pushed = await Promise.all(
      names.map(async (name, index) =>
        push(
          opened.git_path,
          token,
          pushBody({ ref: `refs/heads/bean/${name}`, newSha: await sha(`pool-${index}`) }),
        ),
      ),
    );
    expect(pushed.map((response) => response.status)).toEqual(names.map(() => 200));
    for (const name of names) {
      // oxlint-disable-next-line no-await-in-loop -- each bean is awaited in turn
      await until(engine, name, ['landed', 'green']);
    }

    const perSandbox = await Promise.all(
      [0, 1, 2, 3].map((index) => checksOn(`run-${engine}-sandbox-${index}`)),
    );
    expect(perSandbox[3]).toBe(0);
    expect(perSandbox.reduce((sum, checks) => sum + checks, 0)).toBeGreaterThanOrEqual(
      names.length,
    );
    expect(await checksOn(`run-${engine}-ci-1`)).toBe(0);
    const pool = await json<PoolSnapshot>(
      await call('GET', '/v1/admin/capacity', { token: ADMIN }),
    );
    expect(pool.limits).toEqual({ instances: 48, headroom: 2, floor: 2 });
    expect(pool.leases.filter((lease) => lease.engine === engine)).toEqual([]);
    const stats = pool.stats.find((owner) => owner.owner === engine);
    expect(stats?.granted).toBeGreaterThanOrEqual(names.length);
    expect(stats?.peak).toBeLessThanOrEqual(3);
    expect(stats?.timeouts).toBe(0);
  });

  it('refuses an engine setting it does not know', async () => {
    const response = await call('POST', '/v1/repos', {
      token: ADMIN,
      body: {
        repoName: 'unknown-setting',
        artifactsRepo: 'repo-unknown-setting',
        owner: { id: 'u1', handle: 'acme' },
        settings: { engine: { agents: 64 } },
        create_artifacts_repo: true,
      },
    });
    expect(response.status).toBe(400);
  });
});
