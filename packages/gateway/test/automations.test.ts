import { env, runInDurableObject } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { RunDetail, RunSummary, WorkflowSummary } from '@beanstalk/shared-race/actions';
import type { RepositoryRecord } from '@beanstalk/shared-race/repos';
import type { RpcResult } from '@beanstalk/shared-race/rpc';
import { PersonalTokenInput, createPersonalToken } from '@beanstalk/shared-identity/user-tokens';
import { insertUser } from '@beanstalk/shared-identity/users';

import { mintJobToken } from '../src/actions/job-tokens';
import { call, pkt, sha } from './helpers';

/**
 * Automations end to end on Miniflare (doc 25 §7): a bean adds an automation file, lands and
 * is validated, so the stalk's index has it; a later bean landing is a Beanstalk event that
 * starts the automation as an Actions run (one `agent` job on the stub executor); a person
 * runs it by hand; a second trigger waits while one runs and starts when it ends; the
 * automation's job token pushes its memory ref and, only with `beans: write`, beans.
 */
const actions = exports.Actions;
const ZERO = '0'.repeat(40);
const ON_LAND = '.beanstalk/automations/on-land.yml';

const AUTOMATION = `name: Note landings
on:
  bean_landed:
    beans: ['*', '!add-automations']
harness: shell
permissions:
  beans: write
secrets: [HOOK_KEY]
run: |
  echo "landed: $(jq -r .beanstalk.bean "$GITHUB_EVENT_PATH")" >> "$BEANSTALK_MEMORY/landings.md"
`;
const BROKEN = 'name: Broken\non:\n  pull_request:\nprompt: x\n';

type Person = { readonly id: string; readonly handle: string; readonly token: string };

let coop: Person;
let repo: RepositoryRecord;

beforeAll(async () => {
  coop = await signUp('auto-coop');
  repo = await createRepo('auto-e2e');
  value(
    await actions.putSecret(coop.id, repo.id, {
      name: 'HOOK_KEY',
      value: 'hook-secret-value-123',
      prelandAllowed: false,
    }),
  );
  const pushed = await pushFiles('bean/add-automations', {
    [ON_LAND]: AUTOMATION,
    '.beanstalk/automations/broken.yml': BROKEN,
    'src/a.ts': 'export {}\n',
  });
  expect(pushed.status).toBe(200);
  await vi.waitFor(
    async () => {
      const listed = value(await actions.listWorkflows(coop.id, repo.id));
      if (!listed.some((workflow) => workflow.path === ON_LAND)) throw new Error('not indexed');
    },
    { timeout: 20_000, interval: 100 },
  );
});

describe('Automations: files on the stalk, indexed and validated', () => {
  it('indexes the automation with its agent facts and the invalid file with its problems', async () => {
    const listed = value(await actions.listWorkflows(coop.id, repo.id));
    const onLand = listed.find((workflow) => workflow.path === ON_LAND);
    expect(onLand).toMatchObject({
      name: 'Note landings',
      state: 'active',
      automation: {
        id: 'on-land',
        harness: 'shell',
        permissions: { beans: 'write' },
        secrets: ['HOOK_KEY'],
        memoryRef: 'refs/automations/on-land/memory',
        actor: 'on-land[automation]',
      },
    });
    expect(onLand?.triggers.map((trigger) => trigger.kind)).toEqual([
      'beanstalk',
      'workflow_dispatch',
    ]);
    const broken = listed.find((workflow) => workflow.path.endsWith('broken.yml'));
    expect(broken?.state).toBe('invalid');
    expect(broken?.problems[0]).toMatchObject({
      message: expect.stringContaining('pull_request is not an automation trigger'),
      line: 2,
    });
  });
});

describe('Automations: triggers and runs', () => {
  let first: RunDetail;

  beforeAll(async () => {
    expect((await pushFiles('bean/second', { 'src/b.ts': 'export {}\n' })).status).toBe(200);
    const run = await waitForAutomationRun((runs) =>
      runs.find((one) => one.event === 'bean_landed'),
    );
    first = await waitForRun(run.id);
  }, 40_000);

  it('starts the automation when a bean lands, as one agent job', () => {
    expect(first).toMatchObject({
      workflowPath: ON_LAND,
      workflowName: 'Note landings',
      event: 'bean_landed',
      actor: 'auto-coop',
      status: 'completed',
      conclusion: 'success',
    });
    expect(first.jobs.map((job) => job.key)).toEqual(['agent']);
    expect(first.jobs[0]?.steps.map((step) => step.name)).toContain('Save memory');
  });

  it('lists automation runs apart from workflow runs', async () => {
    const automations = value(await actions.listRuns(coop.id, repo.id, { kind: 'automation' }));
    const workflows = value(await actions.listRuns(coop.id, repo.id, { kind: 'workflow' }));
    expect(automations.runs.map((run) => run.id)).toContain(first.id);
    expect(workflows.runs.map((run) => run.id)).not.toContain(first.id);
  });

  it('runs by hand for a maintainer', async () => {
    const started = value(
      await actions.dispatchWorkflow(coop.id, repo.id, {
        workflowPath: ON_LAND,
        ref: 'main',
        inputs: {},
      }),
    );
    expect(started.event).toBe('workflow_dispatch');
    expect((await waitForRun(started.id)).conclusion).toBe('success');
  });

  it('runs one at a time: a manual run is refused and an event waits, then starts', async () => {
    const busy = crypto.randomUUID();
    await env.FORGE.prepare(
      `INSERT INTO actions_runs (id, repo_id, number, workflow_path, workflow_name, event, ref, sha,
         status, actor, created_at, created_ms)
       VALUES (?, ?, 99, ?, 'Note landings', 'bean_landed', 'refs/heads/main', 'x', 'in_progress', 'x', ?, ?)`,
    )
      .bind(busy, repo.id, ON_LAND, new Date().toISOString(), Date.now())
      .run();
    const stub = env.ACTIONS_REPOS.getByName(repo.id);
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec(
        `INSERT INTO automation_runs (path, run_id, waiting_json) VALUES (?, ?, NULL)
         ON CONFLICT(path) DO UPDATE SET run_id = excluded.run_id`,
        ON_LAND,
        busy,
      );
    });
    const refused = await actions.dispatchWorkflow(coop.id, repo.id, {
      workflowPath: ON_LAND,
      ref: 'main',
      inputs: {},
    });
    expect(refused).toMatchObject({ ok: false, error: { status: 409 } });

    const before = value(await actions.listRuns(coop.id, repo.id, { kind: 'automation' })).runs;
    expect((await pushFiles('bean/third', { 'src/c.ts': 'export {}\n' })).status).toBe(200);
    await vi.waitFor(
      async () => {
        const waiting = await runInDurableObject(stub, async (_instance, state) =>
          state.storage.sql
            .exec<{ waiting_json: string | null }>(
              'SELECT waiting_json FROM automation_runs WHERE path = ?',
              ON_LAND,
            )
            .one(),
        );
        if (waiting.waiting_json === null) throw new Error('the event is not waiting yet');
      },
      { timeout: 20_000, interval: 100 },
    );
    const during = value(await actions.listRuns(coop.id, repo.id, { kind: 'automation' })).runs;
    expect(during.length).toBe(before.length);

    await env.FORGE.prepare("UPDATE actions_runs SET status = 'completed' WHERE id = ?")
      .bind(busy)
      .run();
    await stub.automationEnded({ path: ON_LAND, runId: busy });
    const after = value(await actions.listRuns(coop.id, repo.id, { kind: 'automation' })).runs;
    expect(after.length).toBe(before.length + 1);
    expect(after[0]?.event).toBe('bean_landed');
  });
});

describe('Automations: the job token pushes memory, and beans only with beans: write', () => {
  async function token(canPush: boolean, automationId: string | null): Promise<string> {
    return mintJobToken(env.FORGE, {
      repoId: repo.id,
      engineId: repo.engine_id,
      runId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      canPush,
      expiresMs: Date.now() + 60_000,
      automationId,
    });
  }

  it('pushes its own memory ref, never another automation’s', async () => {
    const reader = await token(false, 'on-land');
    const memory = await pushWith(reader, 'refs/automations/on-land/memory', await sha('mem-1'));
    expect(await memory.text()).toContain('ok refs/automations/on-land/memory');
    const other = await pushWith(reader, 'refs/automations/other/memory', await sha('mem-2'));
    expect(await other.text()).toContain('ng refs/automations/other/memory');
    const workflowJob = await token(true, null);
    const notAnAutomation = await pushWith(
      workflowJob,
      'refs/automations/on-land/memory',
      await sha('mem-3'),
    );
    expect(await notAnAutomation.text()).toContain('ng refs/automations/on-land/memory');
  });

  it('pushes beans only when the file says beans: write', async () => {
    const reader = await token(false, 'on-land');
    const refused = await pushWith(reader, 'refs/heads/bean/on-land-fix', await sha('fix-1'));
    expect(await refused.text()).toContain('may not push beans');
    const writer = await token(true, 'on-land');
    const pushed = await pushWith(writer, 'refs/heads/bean/on-land-fix', await sha('fix-2'));
    expect(await pushed.text()).toContain('ok refs/heads/bean/on-land-fix');
  });
});

// Helpers ----------------------------------------------------------------------------------

async function waitForAutomationRun(
  pick: (runs: readonly RunSummary[]) => RunSummary | undefined,
): Promise<RunSummary> {
  return vi.waitFor(
    async () => {
      const runs = value(await actions.listRuns(coop.id, repo.id, { kind: 'automation' })).runs;
      const found = pick(runs);
      if (found === undefined) throw new Error('no such automation run yet');
      return found;
    },
    { timeout: 20_000, interval: 100 },
  );
}

async function waitForRun(runId: string): Promise<RunDetail> {
  return vi.waitFor(
    async () => {
      const detail = value(await actions.getRun(coop.id, runId));
      if (detail.status !== 'completed') throw new Error(`run is ${detail.status}`);
      return detail;
    },
    { timeout: 20_000, interval: 50 },
  );
}

async function createRepo(name: string): Promise<RepositoryRecord> {
  return value(
    await exports.default.createRepository(coop, {
      name,
      visibility: 'private',
      start: { kind: 'empty' },
    }),
  );
}

async function pushFiles(branch: string, files: Record<string, string>): Promise<Response> {
  const head = await sha(`${repo.id}:${branch}`);
  const commits = { [head]: { message: `Add ${branch}`, parents: [], files } };
  const body = `${pkt(`${ZERO} ${head} refs/heads/${branch}\0report-status side-band-64k\n`)}0000PACK${JSON.stringify({ commits })}`;
  return call('POST', `/git/${repo.owner.handle}/${repo.name}.git/git-receive-pack`, {
    token: coop.token,
    body,
    headers: {
      'content-type': 'application/x-git-receive-pack-request',
      accept: 'application/x-git-receive-pack-result',
    },
  });
}

async function pushWith(token: string, ref: string, head: string): Promise<Response> {
  const commits = { [head]: { message: 'From an automation', parents: [], files: {} } };
  const body = `${pkt(`${ZERO} ${head} ${ref}\0report-status side-band-64k\n`)}0000PACK${JSON.stringify({ commits })}`;
  return call('POST', `/${repo.owner.handle}/${repo.name}.git/git-receive-pack`, {
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

export type { WorkflowSummary };
