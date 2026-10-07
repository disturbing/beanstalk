import { env, SELF } from 'cloudflare:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { verifyUserToken } from '@beanstalk/shared-identity/user-tokens';

import type { Person } from './repo-fixtures';
import {
  deployToken,
  digest,
  gitPush,
  person,
  personalToken,
  plantOnSprout,
  repository,
  slug,
} from './repo-fixtures';

/**
 * The repository tools of an agent session, end to end: the MCP Worker over Streamable HTTP
 * with a person's token, the real gateway behind its service binding (registry, engine,
 * git proxy) and the fake Artifacts and runner.
 */
const ORIGIN = 'https://beanstalk-mcp.example.workers.dev';
const clients: Client[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

async function connect(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
    fetch: (input, init) => {
      // The OAuth provider's handler wants the Host header a real client sends.
      const request = new Request(input, init);
      request.headers.set('host', new URL(request.url).host);
      return SELF.fetch(request);
    },
  });
  const client = new Client({ name: 'repo-tools-test', version: '0.0.0' });
  await client.connect(transport);
  clients.push(client);
  return client;
}

const Content = z.array(z.object({ type: z.literal('text'), text: z.string() }));

/** A tool's answer: JSON on success, `{ error }` with the text on a tool error. */
async function tool(client: Client, name: string, input: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: input });
  const text = Content.parse(result.content)[0]?.text ?? '';
  if (result.isError === true) return { error: text };
  const value: unknown = JSON.parse(text);
  return z.record(z.string(), z.unknown()).parse(value);
}

async function session(
  scopes: readonly string[] = ['read', 'write'],
): Promise<{ user: Person; token: string; client: Client }> {
  const user = await person();
  const token = await personalToken(user, scopes);
  return { user, token, client: await connect(token) };
}

const BACKLOG = '- [ ] add-total: Add a total helper\n- [ ] T-2: Charge tax\n- [x] T-3: Done\n';

describe('repository tools', () => {
  it('are listed for agent sessions and not for run tokens', async () => {
    const { client } = await session();
    const names = (await client.listTools()).tools.map((listed) => listed.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'repo_list',
        'repo_status',
        'bean_open',
        'bean_status',
        'bean_wait',
        'task_list',
        'task_claim',
        'task_release',
        'git_credentials',
        'whoami',
      ]),
    );
    expect(names).not.toContain('execute');
    expect(names).not.toContain('git_credential');
  });

  it("repo_list names the person's repositories with access and clone URL", async () => {
    const { user, client } = await session(['read']);
    const repo = await repository(user);
    expect(await tool(client, 'repo_list')).toMatchObject({
      repositories: [
        {
          repo: slug(repo),
          access: 'read',
          clone_url: `https://gateway.example.test/git/${slug(repo)}.git`,
        },
      ],
    });
  });

  it("repo_status reads a repository by name; someone else's private one is not there", async () => {
    const { user, client } = await session();
    const repo = await repository(user);
    expect(await tool(client, 'repo_status', { repo: slug(repo) })).toMatchObject({
      repo: slug(repo),
      in_flight: [],
      sent_back: [],
      summary: expect.stringContaining('0 in flight'),
    });
    const stranger = await session();
    expect(await tool(stranger.client, 'repo_status', { repo: slug(repo) })).toEqual({
      error: `no repository ${slug(repo)} you can use`,
    });
    // The read tools take the repository too.
    expect(await tool(client, 'run_status', { repo: slug(repo) })).toMatchObject({
      run: repo.engine_id,
    });
    expect(
      await tool(stranger.client, 'work_overlaps', { paths: ['src'], repo: slug(repo) }),
    ).toEqual({
      error: `no repository ${slug(repo)} you can use`,
    });
  });

  it('bean_open needs the write scope, then reserves the name and says how to push', async () => {
    const reader = await session(['read', 'collaborate']);
    const theirs = await repository(reader.user);
    expect(
      await tool(reader.client, 'bean_open', { repo: slug(theirs), bean: 'x', intent: 'Try' }),
    ).toEqual({ error: expect.stringContaining('needs the write scope') });
    const { user, client } = await session();
    const repo = await repository(user);
    const opened = await tool(client, 'bean_open', {
      repo: slug(repo),
      bean: 'add-total',
      intent: 'Add a total helper',
    });
    expect(opened).toMatchObject({
      branch: 'bean/add-total',
      start: 'git fetch origin sprout && git switch -c bean/add-total origin/sprout',
      push: 'git push -o wait origin HEAD:refs/heads/bean/add-total',
      clone_url: `https://gateway.example.test/git/${slug(repo)}.git`,
    });
    expect(
      await tool(client, 'bean_status', { repo: slug(repo), bean: 'add-total' }),
    ).toMatchObject({
      phase: 'open',
      next: expect.stringContaining('git push -o wait'),
    });
    expect(
      await tool(client, 'bean_open', { repo: slug(repo), bean: 'bad name', intent: 'x' }),
    ).toEqual({
      error: expect.stringContaining('not a bean name'),
    });
  });

  it('task_list and task_claim: one claim per task, refused once it is taken or done', async () => {
    const { user, token, client } = await session(['read', 'collaborate', 'write']);
    const repo = await repository(user);
    expect(await tool(client, 'task_list', { repo: slug(repo) })).toMatchObject({
      file: null,
      summary: expect.stringContaining('has no backlog'),
    });
    await plantOnSprout(repo, { '.beanstalk/backlog.md': BACKLOG }, token);
    expect(await tool(client, 'task_list', { repo: slug(repo) })).toMatchObject({
      file: '.beanstalk/backlog.md',
      tasks: [
        { id: 'add-total', state: 'open' },
        { id: 'T-2', state: 'open' },
        { id: 'T-3', state: 'done' },
      ],
    });
    expect(await tool(client, 'task_claim', { repo: slug(repo), task: 'T-2' })).toMatchObject({
      task: { id: 'T-2', state: 'claimed', by: user.handle },
    });
    expect(await tool(client, 'task_release', { repo: slug(repo), task: 'T-2' })).toMatchObject({
      task: { id: 'T-2', state: 'open' },
      summary: expect.stringContaining('Gave task T-2 back'),
    });
    expect(await tool(client, 'task_claim', { repo: slug(repo), task: 'T-3' })).toEqual({
      error: expect.stringContaining('ticked done'),
    });
    expect(await tool(client, 'task_claim', { repo: slug(repo), task: 'nope' })).toEqual({
      error: expect.stringContaining('has no task nope'),
    });
    const readOnly = await connect(await personalToken(user, ['read']));
    expect(await tool(readOnly, 'task_claim', { repo: slug(repo), task: 'add-total' })).toEqual({
      error: expect.stringContaining('needs the collaborate or write scope'),
    });
  });

  it('git_credentials: a repository-bound credential that pushes; bean_wait reads the verdict', async () => {
    const { user, client } = await session();
    const [repo, other] = [await repository(user), await repository(user, { name: 'other' })];
    const answer = z
      .object({ credential: z.string(), scopes: z.array(z.string()), expires_at: z.string() })
      .parse(await tool(client, 'git_credentials', { repo: slug(repo), ttl_minutes: 10 }));
    expect(answer.scopes).toEqual(['read', 'write']);
    expect(Date.parse(answer.expires_at) - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(answer.credential).toContain('host=gateway.example.test');
    expect(answer.credential).toContain(`path=git/${slug(repo)}.git`);
    const password = /^password=(\S+)$/m.exec(answer.credential)?.[1] ?? '';
    expect(password).toMatch(/^bss_/);
    expect((await verifyUserToken(env, password))?.token.repository).toBe(repo.engine_id);

    const pushed = await gitPush(slug(repo), password, {
      bean: 'add-total',
      newSha: await digest('mcp-1'),
      message: 'Add a total helper',
    });
    expect(pushed.remote).toContain('new bean add-total received');
    expect(
      await tool(client, 'bean_wait', { repo: slug(repo), bean: 'add-total', timeout_s: 60 }),
    ).toMatchObject({ phase: expect.stringMatching(/^(landed|green)$/), timed_out: false });
    const status = await tool(client, 'bean_status', { repo: slug(repo), bean: 'bean/add-total' });
    expect(status).toMatchObject({ pushed: { actor: user.handle, title: 'Add a total helper' } });
    expect(JSON.stringify(status['journey'])).toContain('LANDED: add-total');

    // Only that repository, and never as a bearer on /mcp.
    const elsewhere = await gitPush(slug(other), password, {
      bean: 'x',
      newSha: await digest('mcp-2'),
    });
    expect(elsewhere.status).toBe(404);
    const asBearer = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${password}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(asBearer.status).toBe(401);
  });

  it('git_credentials for a read-only session reads but cannot push', async () => {
    const { user, client } = await session(['read']);
    const repo = await repository(user);
    const answer = z
      .object({ credential: z.string(), scopes: z.array(z.string()) })
      .parse(await tool(client, 'git_credentials', { repo: slug(repo) }));
    expect(answer.scopes).toEqual(['read']);
    const password = /^password=(\S+)$/m.exec(answer.credential)?.[1] ?? '';
    const refused = await gitPush(slug(repo), password, { bean: 'x', newSha: await digest('ro') });
    expect(refused.status).toBe(403);
  });

  it('bean_status explains a red: failing tests, the bean it collided with, the next step', async () => {
    const { user, token, client } = await session();
    const repo = await repository(user);
    await gitPush(slug(repo), token, {
      bean: 'tax-rate',
      newSha: await digest('tax'),
      message: 'Charge 10% tax\n\nEvery total includes a 10% tax line.',
      options: ['wait'],
    });
    await gitPush(slug(repo), token, { bean: 'red-discount', newSha: await digest('disc') });
    const red = await tool(client, 'bean_wait', { repo: slug(repo), bean: 'red-discount' });
    expect(red).toMatchObject({
      phase: 'red',
      rework: {
        failing_tests: expect.arrayContaining([expect.any(String)]),
        collided_with: [{ bean: 'tax-rate', intent: expect.stringContaining('10% tax line') }],
      },
      next: expect.stringContaining('git rebase origin/sprout'),
    });
    expect(await tool(client, 'repo_status', { repo: slug(repo) })).toMatchObject({
      sent_back: [{ bean: 'red-discount', phase: 'red', actor: user.handle }],
    });
  });

  it('refuses deploy tokens and repository-bound tokens as /mcp bearers', async () => {
    const user = await person();
    const repo = await repository(user);
    const deploy = await deployToken(user, repo);
    const response = await SELF.fetch(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${deploy}`, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(response.status).toBe(401);
  });
});
