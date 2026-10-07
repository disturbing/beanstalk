import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import {
  PersonalTokenInput,
  createPersonalToken,
  mintSessionToken,
} from '@beanstalk/shared-identity/user-tokens';
import { insertUser } from '@beanstalk/shared-identity/users';
import type { AgentPrincipal, SessionScope } from '@beanstalk/shared-race/agent-repos';
import { TaskId } from '@beanstalk/shared-race/ids';
import type { RepositoryRecord } from '@beanstalk/shared-race/repos';

import { verifyGitCredential } from '../src/auth/git-credential';
import { beanPush, digest, gitPush, plantOnSprout, value } from './agent-helpers';

/**
 * The repository RPC behind the MCP tools (`AgentReposRpc`), through the gateway's default
 * entrypoint as the MCP Worker's binding calls it, with real pushes through the git proxy.
 */
const gateway = exports.default;

let people = 0;

async function person(): Promise<{ id: string; handle: string }> {
  people += 1;
  const user = {
    id: `u_agent_${people}_${crypto.randomUUID().slice(0, 6)}`,
    handle: `agent${people}`,
  };
  await insertUser(env, { ...user, email: null }, Date.now()).run();
  return user;
}

function as(
  user: { id: string; handle: string },
  scopes: readonly SessionScope[] = ['read', 'write'],
): AgentPrincipal {
  return { user, scopes };
}

async function repository(
  owner: { id: string; handle: string },
  options: { name?: string; visibility?: 'public' | 'private' } = {},
): Promise<RepositoryRecord> {
  return value(
    await gateway.createRepository(owner, {
      name: options.name ?? 'shop',
      visibility: options.visibility ?? 'private',
      start: { kind: 'empty' },
    }),
  );
}

async function writeToken(user: { id: string }): Promise<string> {
  const issued = await createPersonalToken(env, {
    userId: user.id,
    request: PersonalTokenInput.parse({ name: 'agent', scopes: ['read', 'write'], days: 7 }),
  });
  return issued.token;
}

function slug(record: RepositoryRecord): string {
  return `${record.owner.handle}/${record.name}`;
}

/** Asks the wait RPC until the bean settles (the engine works between asks). */
async function settled(principal: AgentPrincipal, repo: string, bean: string) {
  return value(
    await gateway.agentWaitBean(principal, repo, bean, { until: 'verdict', seconds: 60 }),
  );
}

const BACKLOG = [
  '# Backlog',
  '- [ ] add-total: Add a total helper',
  '  Sum the line items.',
  '- [ ] T-2: Charge tax',
  '- [x] T-3: Rename the cart',
].join('\n');

describe('agent repositories: access', () => {
  it("lists the person's repositories with what the session may do there", async () => {
    const coop = await person();
    const record = await repository(coop);
    const listed = value(await gateway.agentRepositories(as(coop)));
    expect(listed).toEqual([
      {
        repo: slug(record),
        description: '',
        visibility: 'private',
        access: 'write',
        engine_id: record.engine_id,
        git_path: `/git/${slug(record)}.git`,
      },
    ]);
    const readOnly = value(await gateway.agentRepositories(as(coop, ['read'])));
    expect(readOnly[0]?.access).toBe('read');
  });

  it("answers someone else's private repository as missing and their public one as readable", async () => {
    const [coop, dana] = [await person(), await person()];
    const secret = await repository(coop, { name: 'secret' });
    const open = await repository(coop, { name: 'open', visibility: 'public' });
    const hidden = await gateway.agentRepository(as(dana), slug(secret));
    expect(hidden).toMatchObject({ ok: false, error: { status: 404 } });
    expect(value(await gateway.agentRepository(as(dana), slug(open))).access).toBe('read');
    const push = await gateway.agentOpenBean(as(dana), slug(open), { bean: 'x', intent: 'Try' });
    expect(push).toMatchObject({ ok: false, error: { status: 403 } });
    expect(await gateway.agentRepository(as(dana), 'not a slug')).toMatchObject({
      ok: false,
      error: { status: 400 },
    });
    expect(await gateway.agentRepository(as(coop, []), slug(open))).toMatchObject({
      ok: false,
      error: { status: 403 },
    });
  });
});

describe('agent repositories: beans', () => {
  it('reserves a bean name with its intent; the push takes the reserved intent and task', async () => {
    const coop = await person();
    const record = await repository(coop);
    await plantOnSprout(record, { '.beanstalk/backlog.md': BACKLOG }, await writeToken(coop));
    const repo = slug(record);
    const opened = value(
      await gateway.agentOpenBean(as(coop), repo, {
        bean: 'bean/add-total',
        intent: 'Add a total helper that sums line items',
        task: 'add-total',
      }),
    );
    expect(opened).toMatchObject({
      repo,
      bean: 'add-total',
      branch: 'bean/add-total',
      task: 'add-total',
      sprout: expect.stringMatching(/^[0-9a-f]{40}$/),
    });
    const reserved = value(await gateway.agentBean(as(coop), repo, 'add-total'));
    expect(reserved).toMatchObject({
      phase: 'open',
      pushed: null,
      reservation: { task: 'add-total' },
    });

    const pushed = await gitPush(
      repo,
      await writeToken(coop),
      beanPush({
        bean: 'add-total',
        newSha: await digest('t1'),
        message: 'wip',
        options: ['wait'],
      }),
    );
    expect(pushed.remote).toContain('LANDED: add-total');
    const landed = value(await gateway.agentBean(as(coop), repo, 'add-total'));
    expect(landed).toMatchObject({
      reservation: null,
      pushed: {
        intent: 'Add a total helper that sums line items',
        task: 'add-total',
        actor: coop.handle,
      },
    });
    expect(landed.journey.some((line) => line.text.includes('LANDED'))).toBe(true);
    const tasks = value(await gateway.agentBacklog(as(coop), repo)).tasks;
    expect(tasks.find((task) => task.id === 'add-total')).toMatchObject({
      state: 'done',
      bean: 'add-total',
    });
  });

  it('refuses a name another person reserved, at bean_open and in the git protocol', async () => {
    const coop = await person();
    const record = await repository(coop);
    const repo = slug(record);
    value(await gateway.agentOpenBean(as(coop), repo, { bean: 'mine', intent: 'Mine' }));
    // Renewing one's own reservation is fine.
    value(await gateway.agentOpenBean(as(coop), repo, { bean: 'mine', intent: 'Mine, again' }));
    // A git token for another person on the same engine (as a collaborator would push).
    const other = value(
      await gateway.gitToken(record.engine_id, { id: 'u_other', handle: 'other' }),
    );
    const refused = await gitPush(
      repo,
      other.token,
      beanPush({ bean: 'mine', newSha: await digest('o1') }),
    );
    expect(refused.report).toContain('ng refs/heads/bean/mine bean mine is reserved by @');
    const engine = env.RUNS.getByName(record.engine_id);
    expect(
      await engine.reserveBean({
        bean: TaskId.parse('mine'),
        actor: 'other',
        intent: 'Theirs',
        task: null,
      }),
    ).toEqual({ ok: false, reason: expect.stringContaining(`reserved by @${coop.handle}`) });
  });

  it('refuses to reopen a pushed bean and needs the write scope', async () => {
    const coop = await person();
    const record = await repository(coop);
    const repo = slug(record);
    await gitPush(
      repo,
      await writeToken(coop),
      beanPush({ bean: 'done-one', newSha: await digest('d1'), options: ['wait'] }),
    );
    const again = await gateway.agentOpenBean(as(coop), repo, {
      bean: 'done-one',
      intent: 'Again',
    });
    expect(again).toMatchObject({
      ok: false,
      error: { status: 409, message: expect.stringContaining('pushed already') },
    });
    const readOnly = await gateway.agentOpenBean(as(coop, ['read', 'collaborate']), repo, {
      bean: 'fresh',
      intent: 'Fresh',
    });
    expect(readOnly).toMatchObject({
      ok: false,
      error: { code: 'insufficient_scope', status: 403 },
    });
    const badName = await gateway.agentOpenBean(as(coop), repo, { bean: '../x', intent: 'Bad' });
    expect(badName).toMatchObject({ ok: false, error: { status: 400 } });
  });

  it('describes a red with its failing tests and the landed bean it collided with', async () => {
    const coop = await person();
    const record = await repository(coop);
    const repo = slug(record);
    const token = await writeToken(coop);
    await gitPush(
      repo,
      token,
      beanPush({
        bean: 'tax-rate',
        newSha: await digest('tax'),
        message: 'Charge 10% tax\n\nEvery total includes a 10% tax line.',
        options: ['wait'],
      }),
    );
    await gitPush(repo, token, beanPush({ bean: 'red-discount', newSha: await digest('disc') }));
    const red = await settled(as(coop), repo, 'red-discount');
    expect(red).toMatchObject({ phase: 'red', timed_out: false });
    expect(red.rework?.failing_tests.length).toBeGreaterThan(0);
    expect(red.rework?.collided_with[0]).toMatchObject({
      bean: 'tax-rate',
      title: 'Charge 10% tax',
      intent: expect.stringContaining('Every total includes a 10% tax line.'),
    });
    expect(red.rework?.collided_with[0]?.files).toEqual([
      { path: 'src/tax-rate.ts', additions: null, deletions: null },
    ]);
    const beans = value(await gateway.agentPushedBeans(as(coop), repo));
    expect(beans[0]).toMatchObject({ bean: 'red-discount', phase: 'red' });
  });

  it('waits for a verdict, answers a reserved bean at once, and refuses bad waits', async () => {
    const coop = await person();
    const record = await repository(coop);
    const repo = slug(record);
    await gitPush(
      repo,
      await writeToken(coop),
      beanPush({ bean: 'quick', newSha: await digest('q') }),
    );
    const waited = value(
      await gateway.agentWaitBean(as(coop), repo, 'quick', { until: 'stalk', seconds: 60 }),
    );
    expect(waited).toMatchObject({ phase: 'green', timed_out: false });
    value(await gateway.agentOpenBean(as(coop), repo, { bean: 'later', intent: 'Later' }));
    expect(
      value(await gateway.agentWaitBean(as(coop), repo, 'later', { until: 'verdict', seconds: 5 })),
    ).toMatchObject({
      phase: 'open',
      waited_s: 0,
    });
    expect(
      await gateway.agentWaitBean(as(coop), repo, 'quick', { until: 'verdict', seconds: 0 }),
    ).toMatchObject({
      ok: false,
      error: { status: 400 },
    });
    expect(await gateway.agentBean(as(coop), repo, 'nobody')).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
  });
});

describe('agent repositories: backlog', () => {
  it('reads no backlog when the repository has none', async () => {
    const coop = await person();
    const record = await repository(coop);
    expect(value(await gateway.agentBacklog(as(coop), slug(record)))).toEqual({
      repo: slug(record),
      file: null,
      tasks: [],
    });
    expect(await gateway.agentClaimTask(as(coop), slug(record), 'T-2')).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
  });

  it('lets one agent claim a task and tells the next who holds it', async () => {
    const coop = await person();
    const record = await repository(coop, { visibility: 'public' });
    await plantOnSprout(record, { 'BACKLOG.md': BACKLOG }, await writeToken(coop));
    const repo = slug(record);
    const listed = value(await gateway.agentBacklog(as(coop), repo));
    expect(listed.file).toBe('BACKLOG.md');
    expect(listed.tasks.map((task) => [task.id, task.state])).toEqual([
      ['add-total', 'open'],
      ['T-2', 'open'],
      ['T-3', 'done'],
    ]);
    const claimed = value(
      await gateway.agentClaimTask(as(coop, ['read', 'collaborate']), repo, 'T-2'),
    );
    expect(claimed.task).toMatchObject({ id: 'T-2', state: 'claimed', by: coop.handle });
    // Another agent with push access (a collaborator's session) asks the same engine.
    const engine = env.RUNS.getByName(record.engine_id);
    expect(await engine.claimTask({ task: 'T-2', actor: 'other-agent' })).toEqual({
      ok: false,
      reason: expect.stringContaining(`claimed by @${coop.handle}`),
    });
    expect(await engine.claimTask({ task: 'add-total', actor: 'other-agent' })).toMatchObject({
      ok: true,
    });
    expect(await gateway.agentClaimTask(as(coop), repo, 'add-total')).toMatchObject({
      ok: false,
      error: { status: 409, message: expect.stringContaining('claimed by @other-agent') },
    });
    // A reader of the public repository may not take its tasks.
    const dana = await person();
    expect(
      await gateway.agentClaimTask(as(dana, ['read', 'collaborate']), repo, 'T-2'),
    ).toMatchObject({
      ok: false,
      error: { status: 403 },
    });
    expect(await gateway.agentClaimTask(as(dana, ['read']), repo, 'T-2')).toMatchObject({
      ok: false,
      error: { code: 'insufficient_scope' },
    });
    expect(await gateway.agentClaimTask(as(coop), repo, 'T-3')).toMatchObject({
      ok: false,
      error: { status: 409, message: expect.stringContaining('ticked done') },
    });
    expect(await gateway.agentClaimTask(as(coop), repo, 'T-9')).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
  });

  it('shows a task in progress while a bean for it is out, and refuses to claim it', async () => {
    const coop = await person();
    const record = await repository(coop);
    await plantOnSprout(record, { '.beanstalk/backlog.md': BACKLOG }, await writeToken(coop));
    const repo = slug(record);
    await gitPush(
      repo,
      await writeToken(coop),
      beanPush({
        bean: 'red-tax',
        newSha: await digest('rt'),
        message: 'Charge tax\n\nTask: T-2',
        options: ['wait'],
      }),
    );
    const tasks = value(await gateway.agentBacklog(as(coop), repo)).tasks;
    expect(tasks.find((task) => task.id === 'T-2')).toMatchObject({
      state: 'in_progress',
      by: coop.handle,
      bean: 'red-tax',
    });
    const engine = env.RUNS.getByName(record.engine_id);
    expect(await engine.claimTask({ task: 'T-2', actor: 'other-agent' })).toEqual({
      ok: false,
      reason: expect.stringContaining(`in progress: @${coop.handle}'s bean red-tax`),
    });
    // The bean's own author may still claim it (renewing their hold).
    expect(value(await gateway.agentClaimTask(as(coop), repo, 'T-2')).task.state).toBe(
      'in_progress',
    );
  });
});

describe('repository-bound session tokens', () => {
  it('open only the repository they were minted for', async () => {
    const coop = await person();
    const [first, second] = [
      await repository(coop, { name: 'one' }),
      await repository(coop, { name: 'two' }),
    ];
    const minted = await mintSessionToken(env, {
      userId: coop.id,
      label: 'Claude Code (MCP git)',
      scopes: ['read', 'write'],
      repository: first.engine_id,
    });
    const credential = await verifyGitCredential(
      { tokenSecret: env.RUN_TOKEN_SECRET, now: () => Date.now(), identity: env },
      minted.token,
    );
    expect(credential).toMatchObject({
      engine: first.engine_id,
      scopes: ['repo:read', 'bean:write'],
    });
    const landed = await gitPush(
      slug(first),
      minted.token,
      beanPush({ bean: 'bound', newSha: await digest('b'), options: ['wait'] }),
    );
    expect(landed.remote).toContain('LANDED: bound');
    const elsewhere = await gitPush(
      slug(second),
      minted.token,
      beanPush({ bean: 'bound', newSha: await digest('b2') }),
    );
    expect(elsewhere.status).toBe(404);
  });
});
