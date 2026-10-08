import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { JobView, LogFrame, RunDetail, RunSummary } from '@beanstalk/shared-race/actions';
import type { RepositoryRecord } from '@beanstalk/shared-race/repos';
import type { RpcResult } from '@beanstalk/shared-race/rpc';
import { PersonalTokenInput, createPersonalToken } from '@beanstalk/shared-identity/user-tokens';
import { insertUser } from '@beanstalk/shared-identity/users';

import {
  mintJobToken,
  revokeJobTokens,
  tokenHash,
  verifyJobToken,
} from '../src/actions/job-tokens';
import { call, pkt, sha } from './helpers';

/**
 * Actions end to end on Miniflare (doc 25): a push lands, the stalk moves, the repo-events
 * consumer tells the repository's ActionsRepoDO, which indexes `.github/workflows/` and starts
 * the runs; each ActionsRunDO walks its DAG on the stub executor, which reports through the
 * ActionsJobs sink like the container executor will. Then dispatch, cancel, timeouts, limits,
 * secrets, job tokens and the log relay.
 */
const gateway = exports.default;
const actions = exports.Actions;
const sink = exports.ActionsJobs;
const ZERO = '0'.repeat(40);

type Person = { readonly id: string; readonly handle: string; readonly token: string };

let coop: Person;
let stranger: Person;

beforeAll(async () => {
  coop = await signUp('act-coop');
  stranger = await signUp('act-stranger');
});

const CI = `name: CI
on:
  push:
    branches: [main]
  workflow_dispatch:
    inputs:
      who: { type: string, default: world }
jobs:
  build:
    runs-on: ubuntu-latest
    outputs:
      v: \${{ steps.s.outputs.v }}
    steps:
      - uses: actions/checkout@v4
      - id: s
        run: |
          echo "v=42" >> $GITHUB_OUTPUT
          echo token \${{ secrets.DEPLOY_TOKEN }}
  test:
    needs: build
    runs-on: ubuntu-latest
    strategy: { matrix: { node: [20, 22] } }
    steps:
      - run: echo node \${{ matrix.node }} got \${{ needs.build.outputs.v }}
  broken:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - run: exit 3
  after-broken:
    needs: broken
    runs-on: ubuntu-latest
    steps: [{ run: echo never }]
  cleanup:
    needs: broken
    if: always()
    runs-on: ubuntu-latest
    steps: [{ run: echo cleaning }]
`;

describe('Actions: a push to the stalk runs the workflow on the stub executor', () => {
  let repo: RepositoryRecord;
  let run: RunSummary;

  beforeAll(async () => {
    repo = await createRepo('act-ci');
    value(
      await actions.putSecret(coop.id, repo.id, {
        name: 'deploy_token',
        value: 'cf-secret-value-123',
        prelandAllowed: false,
      }),
    );
    const pushed = await pushFiles(repo, 'bean/add-ci', {
      '.github/workflows/ci.yml': CI,
      'src/a.ts': 'export {}\n',
    });
    expect(pushed.status).toBe(200);
    run = await vi.waitFor(
      async () => {
        const [first] = value(await actions.listRuns(coop.id, repo.id, {})).runs;
        if (first?.status !== 'completed') throw new Error('no completed run yet');
        return first;
      },
      { timeout: 20_000, interval: 100 },
    );
  });

  it('indexes the workflow from the stalk', async () => {
    const [workflow] = value(await actions.listWorkflows(coop.id, repo.id));
    expect(workflow).toMatchObject({
      path: '.github/workflows/ci.yml',
      name: 'CI',
      state: 'active',
    });
    expect(workflow?.sha).toBe(run.sha);
    expect(workflow?.jobs.map((job) => job.key)).toEqual([
      'build',
      'test',
      'broken',
      'after-broken',
      'cleanup',
    ]);
  });

  it('runs the DAG: needs, matrix legs, failure, skip and always()', async () => {
    expect(run).toMatchObject({
      number: 1,
      event: 'push',
      ref: 'refs/heads/main',
      actor: 'act-coop',
      conclusion: 'failure',
    });
    const detail = value(await actions.getRun(coop.id, run.id));
    const byName = Object.fromEntries(detail.jobs.map((job) => [job.name, job]));
    expect(byName['build']).toMatchObject({ conclusion: 'success', outputs: { v: '42' } });
    expect(byName['test (20)']?.conclusion).toBe('success');
    expect(byName['test (22)']?.conclusion).toBe('success');
    expect(byName['broken']).toMatchObject({ conclusion: 'failure' });
    expect(byName['after-broken']?.conclusion).toBe('skipped');
    expect(byName['cleanup']?.conclusion).toBe('success');
    expect(detail.minutesBilled).toBe(5);
  });

  it('keeps logs in R2 chunks, with the secret masked and needs outputs passed', async () => {
    const detail = value(await actions.getRun(coop.id, run.id));
    const build = jobNamed(detail, 'build');
    const page = value(await actions.logChunks(coop.id, run.id, build.id));
    expect(page.complete).toBe(true);
    const text = page.chunks.flatMap((chunk) => chunk.lines.map((line) => line.text)).join('\n');
    expect(text).toContain('token ***');
    expect(text).not.toContain('cf-secret-value-123');
    const leg = value(await actions.logChunks(coop.id, run.id, jobNamed(detail, 'test (22)').id));
    expect(leg.chunks[0]?.lines.map((line) => line.text)).toEqual(
      expect.arrayContaining(['node 22 got 42']),
    );
    const listed = await env.ACTIONS_LOGS.list({
      prefix: `${coop.id}/${repo.id}/${run.id}/${build.id}/`,
    });
    expect(listed.objects.map((object) => object.key.split('/').at(-1))).toEqual([
      '0000000001.log.gz',
    ]);
  });

  it('revokes every job token when its job ends', async () => {
    const rows = await env.FORGE.prepare(
      'SELECT revoked_ms FROM actions_job_tokens WHERE run_id = ?',
    )
      .bind(run.id)
      .all();
    expect(rows.results.length).toBe(5);
    expect(rows.results.every((row) => typeof row['revoked_ms'] === 'number')).toBe(true);
  });

  it('dispatches with inputs for maintainers only, and hides runs from strangers', async () => {
    expect(
      await actions.dispatchWorkflow(stranger.id, repo.id, {
        workflowPath: '.github/workflows/ci.yml',
        ref: 'main',
        inputs: {},
      }),
    ).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    expect(await actions.getRun(stranger.id, run.id)).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    expect(await actions.listSecrets(stranger.id, repo.id)).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    expect(
      await actions.dispatchWorkflow(coop.id, repo.id, {
        workflowPath: '.github/workflows/ci.yml',
        ref: 'sprout',
        inputs: {},
      }),
    ).toMatchObject({
      ok: false,
      error: { status: 400 },
    });
    expect(
      await actions.dispatchWorkflow(coop.id, repo.id, {
        workflowPath: '.github/workflows/ci.yml',
        ref: 'main',
        inputs: { nope: 'x' },
      }),
    ).toMatchObject({
      ok: false,
      error: { status: 400 },
    });
    const dispatched = value(
      await actions.dispatchWorkflow(coop.id, repo.id, {
        workflowPath: '.github/workflows/ci.yml',
        ref: 'stalk',
        inputs: { who: 'coop' },
      }),
    );
    expect(dispatched).toMatchObject({ number: 2, event: 'workflow_dispatch', actor: 'act-coop' });
    const done = await waitForRun(dispatched.id);
    expect(done.inputs).toEqual({ who: 'coop' });
    const page = value(await actions.listRuns(coop.id, repo.id, { limit: 1 }));
    expect(page.runs.map((listed) => listed.number)).toEqual([2]);
    const older = value(
      await actions.listRuns(coop.id, repo.id, { limit: 1, cursor: page.next ?? '' }),
    );
    expect(older.runs.map((listed) => listed.number)).toEqual([1]);
  });

  it('lists secrets without values and audits changes', async () => {
    const listed = value(await actions.listSecrets(coop.id, repo.id));
    expect(listed).toEqual([
      expect.objectContaining({
        name: 'DEPLOY_TOKEN',
        prelandAllowed: false,
        updatedBy: 'act-coop',
      }),
    ]);
    expect(JSON.stringify(listed)).not.toContain('cf-secret-value-123');
    const audit = await env.FORGE.prepare(
      "SELECT detail FROM repository_audit WHERE repo_id = ? AND action = 'actions-secret-set'",
    )
      .bind(repo.id)
      .first();
    expect(audit).toEqual({ detail: 'DEPLOY_TOKEN' });
  });
});

const HANG = `on: workflow_dispatch
jobs:
  slow:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: sleep 600
        env:
          RELAY: \${{ secrets.RELAY }}
  next:
    needs: slow
    runs-on: ubuntu-latest
    steps: [{ run: echo next }]
`;

const WIDE = `on: workflow_dispatch
jobs:
  wide:
    runs-on: ubuntu-latest
    strategy: { matrix: { n: [1, 2, 3, 4, 5] } }
    steps: [{ run: sleep 600 }]
`;

describe('Actions: cancel, timeouts, limits and the live log relay', () => {
  let repo: RepositoryRecord;

  beforeAll(async () => {
    repo = await createRepo('act-limits');
    const pushed = await pushFiles(repo, 'bean/add-workflows', {
      '.github/workflows/hang.yml': HANG,
      '.github/workflows/wide.yml': WIDE,
    });
    expect(pushed.status).toBe(200);
    await vi.waitFor(
      async () => {
        if (value(await actions.listWorkflows(coop.id, repo.id)).length < 2)
          throw new Error('not indexed');
      },
      { timeout: 20_000, interval: 100 },
    );
  });

  it('cancels a running job and skips what needed it', async () => {
    const started = await dispatch(repo, '.github/workflows/hang.yml');
    await waitForJob(started.id, 'slow', 'in_progress');
    const cancelled = value(await actions.cancelRun(coop.id, started.id));
    expect(cancelled).toMatchObject({ status: 'completed', conclusion: 'cancelled' });
    const detail = await waitForRun(started.id);
    expect(jobNamed(detail, 'slow').conclusion).toBe('cancelled');
    expect(jobNamed(detail, 'next').conclusion).toBe('cancelled');
    expect(await actions.cancelRun(stranger.id, started.id)).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
  });

  it('times a job out at its limit', async () => {
    const started = await dispatch(repo, '.github/workflows/hang.yml');
    await waitForJob(started.id, 'slow', 'in_progress');
    const stub = env.ACTIONS_RUNS.getByName(started.id);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        "UPDATE jobs SET started_ms = ? WHERE key = 'slow'",
        Date.now() - 6 * 60_000,
      );
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const detail = await waitForRun(started.id);
    expect(jobNamed(detail, 'slow')).toMatchObject({
      conclusion: 'timed_out',
      reason: 'the job ran past its 5-minute limit',
    });
    expect(jobNamed(detail, 'next').conclusion).toBe('skipped');
    expect(detail.conclusion).toBe('failure');
  });

  it('runs at most 4 jobs of a repository at once; the fifth waits', async () => {
    const started = await dispatch(repo, '.github/workflows/wide.yml');
    const detail = await vi.waitFor(
      async () => {
        const read = value(await actions.getRun(coop.id, started.id));
        if (read.jobs.filter((job) => job.status === 'in_progress').length < 4)
          throw new Error('not started');
        return read;
      },
      { timeout: 10_000, interval: 50 },
    );
    expect(detail.jobs.map((job) => job.status).toSorted()).toEqual([
      'in_progress',
      'in_progress',
      'in_progress',
      'in_progress',
      'waiting',
    ]);
    value(await actions.cancelRun(coop.id, started.id));
  });

  it('relays live lines to a watcher, masked, and stores them in R2 (never in the DO)', async () => {
    value(
      await actions.putSecret(coop.id, repo.id, {
        name: 'RELAY',
        value: 'relay-secret-xyz',
        prelandAllowed: false,
      }),
    );
    const started = await dispatch(repo, '.github/workflows/hang.yml');
    const slow = await waitForJob(started.id, 'slow', 'in_progress');
    // Stand in for the container executor: give the job a report token we know.
    await runInDurableObject(env.ACTIONS_RUNS.getByName(started.id), async (_instance, state) => {
      state.storage.sql.exec(
        'UPDATE jobs SET report_hash = ? WHERE id = ?',
        await tokenHash('known-secret'),
        slow.id,
      );
    });
    const report = `${started.id}.${slow.id}.known-secret`;
    const ticket = value(await actions.logStream(coop.id, started.id, slow.id));
    expect(ticket.url).toMatch(/^wss:\/\/.+\/v1\/actions\/runs\/.+\/jobs\/.+\/logs$/);
    expect(await actions.logStream(stranger.id, started.id, slow.id)).toMatchObject({ ok: false });
    const path = new URL(ticket.url).pathname;
    const refused = await call('GET', `${path}?token=bad`, { headers: { upgrade: 'websocket' } });
    expect(refused.status).toBe(401);
    const upgraded = await call('GET', `${path}?token=${encodeURIComponent(ticket.token)}`, {
      headers: { upgrade: 'websocket' },
    });
    const socket = upgraded.webSocket;
    if (socket === null) throw new Error('no socket');
    socket.accept();
    const frames: LogFrame[] = [];
    socket.addEventListener('message', (event) => frames.push(JSON.parse(String(event.data))));

    expect(await sink.actionsJobSecrets(report)).toEqual({
      ok: true,
      value: { RELAY: 'relay-secret-xyz' },
    });
    expect(await sink.actionsJobSecrets(`${started.id}.${slow.id}.wrong`)).toMatchObject({
      ok: false,
      error: { status: 401 },
    });
    const at = new Date().toISOString();
    const batch = {
      seq: 1,
      lines: [{ step: 1, at, text: 'value relay-secret-xyz here' }],
      steps: [],
    };
    expect(await sink.actionsJobLogs(report, batch)).toEqual({
      ok: true,
      value: { cancelRequested: false },
    });
    expect(await sink.actionsJobLogs(report, batch)).toEqual({
      ok: true,
      value: { cancelRequested: false },
    });
    await vi.waitFor(() => {
      if (!frames.some((frame) => frame.kind === 'lines')) throw new Error('no lines yet');
    });
    const lines = frames.filter((frame) => frame.kind === 'lines');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ seq: 1, lines: [{ text: 'value *** here' }] });

    expect(
      await sink.actionsJobFinished(report, {
        conclusion: 'success',
        outputs: { leak: 'relay-secret-xyz', fine: 'ok' },
        durationMs: 1000,
        minutesBilled: 1,
        steps: [],
        error: null,
      }),
    ).toEqual({ ok: true, value: { accepted: true } });
    await vi.waitFor(() => {
      if (!frames.some((frame) => frame.kind === 'job' && frame.status === 'completed'))
        throw new Error('no end frame');
    });
    const finished = jobNamed(await waitForRun(started.id), 'slow');
    expect(finished.outputs).toEqual({ fine: 'ok' });
    const stored = value(await actions.logChunks(coop.id, started.id, slow.id));
    expect(stored.chunks).toEqual([{ seq: 1, lines: [{ step: 1, at, text: 'value *** here' }] }]);
    await runInDurableObject(env.ACTIONS_RUNS.getByName(started.id), async (_instance, state) => {
      const tables = state.storage.sql
        .exec<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND name NOT LIKE 'sqlite%'",
        )
        .toArray();
      const everything = tables.flatMap((table) =>
        state.storage.sql.exec(`SELECT * FROM ${table.name}`).toArray(),
      );
      expect(JSON.stringify(everything)).not.toContain('value *** here');
    });
  });

  it('refuses runs once the month’s minutes are used', async () => {
    const repoDo = env.ACTIONS_REPOS.getByName(repo.id);
    await repoDo.addMinutes(1000);
    expect(
      await actions.dispatchWorkflow(coop.id, repo.id, {
        workflowPath: '.github/workflows/hang.yml',
        ref: 'main',
        inputs: {},
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'over_limit', status: 429 },
    });
    expect((await repoDo.usage()).limit).toBe(100);
  });
});

describe('Actions: schedules', () => {
  it('keeps a schedule per cron line as the repository’s alarm, and runs it on the stalk', async () => {
    const repo = await createRepo('act-cron');
    const nightly =
      'on:\n  schedule: [{ cron: "*/15 * * * *" }]\njobs:\n  n:\n    runs-on: ubuntu-latest\n    steps: [{ run: echo nightly }]\n';
    expect(
      (await pushFiles(repo, 'bean/add-cron', { '.github/workflows/nightly.yml': nightly })).status,
    ).toBe(200);
    const stub = env.ACTIONS_REPOS.getByName(repo.id);
    const next = await vi.waitFor(
      async () =>
        runInDurableObject(stub, async (_instance, state) => {
          const row = state.storage.sql
            .exec<{ next_ms: number }>('SELECT next_ms FROM schedules')
            .toArray()[0];
          if (row === undefined) throw new Error('no schedule yet');
          return row.next_ms;
        }),
      { timeout: 20_000, interval: 100 },
    );
    expect(new Date(next).getUTCMinutes() % 15).toBe(0);
    expect(await stub.minutesLeft()).toBe(100);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec('UPDATE schedules SET next_ms = ?', Date.now() - 1000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    const [run] = value(await actions.listRuns(coop.id, repo.id, {})).runs;
    expect(run).toMatchObject({ event: 'schedule', actor: 'schedule', number: 1 });
    const detail = await waitForRun(run?.id ?? '');
    expect(detail.conclusion).toBe('success');
    const after = await runInDurableObject(stub, async (_instance, state) =>
      state.storage.sql
        .exec<{ next_ms: number; last_ms: number }>('SELECT next_ms, last_ms FROM schedules')
        .one(),
    );
    expect(after.next_ms - after.last_ms).toBeGreaterThanOrEqual(4 * 60_000);
  });
});

describe('Actions: job tokens (GITHUB_TOKEN)', () => {
  it('reads the repository at the GitHub-shaped path, pushes beans only with contents: write, and dies when revoked', async () => {
    const repo = await createRepo('act-token');
    const grant = {
      repoId: repo.id,
      engineId: repo.engine_id,
      runId: crypto.randomUUID(),
      expiresMs: Date.now() + 60_000,
    };
    const reader = await mintJobToken(env.FORGE, {
      ...grant,
      jobId: crypto.randomUUID(),
      canPush: false,
    });
    const writerJob = crypto.randomUUID();
    const writer = await mintJobToken(env.FORGE, { ...grant, jobId: writerJob, canPush: true });
    const auth = (token: string) => ({
      authorization: `Basic ${btoa(`x-access-token:${token}`)}`,
      'user-agent': 'git/2.47.0',
    });
    const refs = await call(
      'GET',
      `/${repo.owner.handle}/${repo.name}/info/refs?service=git-upload-pack`,
      { headers: auth(reader) },
    );
    expect(refs.status).toBe(200);
    const other = await createRepo('act-token-other');
    const elsewhere = await call(
      'GET',
      `/${other.owner.handle}/${other.name}/info/refs?service=git-upload-pack`,
      { headers: auth(reader) },
    );
    expect(elsewhere.status).toBe(404);

    const readerPush = await pushWith(repo, reader, 'refs/heads/bean/from-job', await sha('job-1'));
    expect(readerPush.status).not.toBe(200);
    const writerPush = await pushWith(repo, writer, 'refs/heads/bean/from-job', await sha('job-2'));
    expect(await writerPush.text()).toContain('ok refs/heads/bean/from-job');
    const mainPush = await pushWith(repo, writer, 'refs/heads/main', await sha('job-3'));
    expect(await mainPush.text()).toContain('ng refs/heads/main');

    await revokeJobTokens(env.FORGE, writerJob, Date.now());
    expect(await verifyJobToken(env.FORGE, writer, Date.now())).toBeNull();
    expect(await verifyJobToken(env.FORGE, reader, Date.now() + 120_000)).toBeNull();
  });
});

// Helpers ----------------------------------------------------------------------------------

async function createRepo(name: string): Promise<RepositoryRecord> {
  return value(
    await gateway.createRepository(coop, { name, visibility: 'private', start: { kind: 'empty' } }),
  );
}

async function dispatch(repo: RepositoryRecord, workflowPath: string): Promise<RunSummary> {
  return value(
    await actions.dispatchWorkflow(coop.id, repo.id, { workflowPath, ref: 'main', inputs: {} }),
  );
}

async function waitForRun(runId: string): Promise<RunDetail> {
  return vi.waitFor(
    async () => {
      const detail = value(await actions.getRun(coop.id, runId));
      if (detail.status !== 'completed') throw new Error(`run is ${detail.status}`);
      return detail;
    },
    { timeout: 10_000, interval: 50 },
  );
}

async function waitForJob(
  runId: string,
  name: string,
  status: JobView['status'],
): Promise<JobView> {
  return vi.waitFor(
    async () => {
      const job = jobNamed(value(await actions.getRun(coop.id, runId)), name);
      if (job.status !== status) throw new Error(`${name} is ${job.status}`);
      return job;
    },
    { timeout: 10_000, interval: 50 },
  );
}

function jobNamed(detail: RunDetail, name: string): JobView {
  const job = detail.jobs.find((candidate) => candidate.name === name);
  if (job === undefined) throw new Error(`no job ${name}`);
  return job;
}

/** Pushes one bean carrying `files` (the fake remote reads the JSON pack). */
async function pushFiles(
  record: RepositoryRecord,
  branch: string,
  files: Record<string, string>,
): Promise<Response> {
  const head = await sha(`${record.id}:${branch}`);
  const commits = { [head]: { message: `Add ${branch}`, parents: [], files } };
  const body = `${pkt(`${ZERO} ${head} refs/heads/${branch}\0report-status side-band-64k\n`)}0000PACK${JSON.stringify({ commits })}`;
  return call('POST', `/git/${record.owner.handle}/${record.name}.git/git-receive-pack`, {
    token: coop.token,
    body,
    headers: {
      'content-type': 'application/x-git-receive-pack-request',
      accept: 'application/x-git-receive-pack-result',
    },
  });
}

async function pushWith(
  record: RepositoryRecord,
  token: string,
  ref: string,
  head: string,
): Promise<Response> {
  const commits = { [head]: { message: 'From a job', parents: [], files: {} } };
  const body = `${pkt(`${ZERO} ${head} ${ref}\0report-status side-band-64k\n`)}0000PACK${JSON.stringify({ commits })}`;
  return call('POST', `/${record.owner.handle}/${record.name}.git/git-receive-pack`, {
    body,
    headers: {
      authorization: `Basic ${btoa(`x-access-token:${token}`)}`,
      'content-type': 'application/x-git-receive-pack-request',
      accept: 'application/x-git-receive-pack-result',
    },
  });
}

async function signUp(handle: string): Promise<Person> {
  const id = `u_${handle.replace(/-/g, '_')}`;
  await insertUser(env, { id, handle, email: null }, Date.now()).run();
  const pat = await createPersonalToken(env, {
    userId: id,
    request: PersonalTokenInput.parse({ name: 'laptop', scopes: ['read', 'write'], days: 7 }),
  });
  return { id, handle, token: pat.token };
}

function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
