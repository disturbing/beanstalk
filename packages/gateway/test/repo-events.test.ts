import { createExecutionContext, createMessageBatch, env, getQueueResult } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { RepoEvent, RepoEventsMessage } from '@gitstalk/shared-race/repo-events';
import type { RepositoryRecord } from '@gitstalk/shared-race/repos';
import type { RpcResult } from '@gitstalk/shared-race/rpc';
import { PersonalTokenInput, createPersonalToken } from '@gitstalk/shared-identity/user-tokens';
import { insertUser } from '@gitstalk/shared-identity/users';

import { createLogger } from '../src/log';
import { consumeRepoEvents } from '../src/repo-events/consumer';
import { d1Registry } from '../src/repos/registry';
import { call, pkt, sha } from './helpers';

/**
 * `repo-events` end to end (docs/claude-opus/20-repositories.md §6): a real push to a
 * registered repository lands and is validated by its engine; the engine's Durable Object
 * sends the events through the real (Miniflare) queue to this Worker's consumer, which writes
 * the D1 indexes History's validation view, Home's growth and Home's activity read. Then the consumer's
 * guarantees, message by message: redelivery and reordering change nothing, strangers are
 * dropped.
 */
const gateway = exports.default;
const ZERO = '0'.repeat(40);

type Person = { readonly id: string; readonly handle: string; readonly token: string };

let coop: Person;
let repo: RepositoryRecord;

beforeAll(async () => {
  coop = await signUp('ev-coop');
  repo = value(
    await gateway.createRepository(coop, {
      name: 'events',
      visibility: 'private',
      start: { kind: 'empty' },
    }),
  );
});

describe('repo-events: engine → queue → D1 indexes', () => {
  it('indexes a pushed bean from push to the stalk, and Home reads it from D1', async () => {
    const head = await sha('ev-bean-1');
    const pushed = await push(repo, coop.token, 'bean/add-total', head, 'Add a total helper');
    expect(pushed.status).toBe(200);

    const stalk = await vi.waitFor(
      async () => {
        const read = value(await gateway.repositoryStalk(repo.id, coop.id));
        if (read.promotions.length === 0) throw new Error('not promoted yet');
        return read;
      },
      { timeout: 15_000, interval: 100 },
    );
    const promoted = stalk.promotions[0];
    expect(promoted).toMatchObject({ kind: 'promoted' });
    expect(promoted?.beans.map((bean) => bean.bean)).toEqual(['add-total']);
    expect(promoted?.beans[0]).toMatchObject({
      state: 'promoted',
      actor: 'ev-coop',
      title: 'Add a total helper',
    });
    expect(promoted?.beans[0]?.landed_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(stalk.lines?.stalk_sha).toBe(promoted?.sha);
    expect(stalk.lines?.sprout_sha).toBe(promoted?.beans[0]?.landed_sha);
    expect(stalk.days[0]).toMatchObject({ landed: 1, promoted: 1 });
    expect(stalk.activity.map((line) => line.kind)).toEqual(
      expect.arrayContaining(['opened', 'landed', 'promoted', 'created']),
    );
    // History's verdicts: only lines that judge a commit, the promotion's naming its stalk head.
    expect(stalk.verdicts.map((line) => [line.kind, line.sha])).toEqual([
      ['promoted', promoted?.sha],
    ]);

    const growth = value(await gateway.repositoryGrowth([repo.id], coop.id));
    expect(growth).toEqual([{ repo_id: repo.id, landed: 1, growing: 0, indexed: true }]);
    const home = value(await gateway.repositoryActivity(coop.id, 10));
    expect(home[0]).toMatchObject({ repo_name: 'events', kind: 'promoted' });
    expect(home.find((line) => line.kind === 'landed')?.text).toContain(
      'add-total landed on the sprout',
    );
  });

  it('answers the index only to people who may read the repository', async () => {
    const stranger = await signUp('ev-stranger');
    expect(await gateway.repositoryStalk(repo.id, stranger.id)).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    expect(value(await gateway.repositoryGrowth([repo.id], stranger.id))).toEqual([]);
  });
});

describe('repo-events consumer', () => {
  it('writes the same rows when a message is delivered twice or out of order', async () => {
    const record = value(
      await gateway.createRepository(coop, {
        name: 'replays',
        visibility: 'private',
        start: { kind: 'empty' },
      }),
    );
    const engine = record.engine_id;
    const opened = event({
      seq: 10,
      kind: 'bean.opened',
      bean: 'b1',
      title: 'One',
      actor: 'ev-coop',
    });
    const landed = event({
      seq: 11,
      kind: 'bean.landed',
      bean: 'b1',
      sha: 'a'.repeat(40),
      trunk_idx: 1,
      files: 2,
      actor: 'ev-coop',
    });
    const promotedEvent = event({
      seq: 12,
      kind: 'stalk.promoted',
      sha: 'a'.repeat(40),
      trunk_idx: 1,
      beans: ['b1'],
    });
    // The promotion first, then everything again: the newest state stays, nothing doubles.
    await consume([message(engine, [promotedEvent])]);
    await consume([message(engine, [opened, landed, promotedEvent])]);
    await consume([message(engine, [opened, landed])]);
    const stalk = value(await gateway.repositoryStalk(record.id, coop.id));
    expect(stalk.promotions).toHaveLength(1);
    expect(stalk.promotions[0]?.beans[0]).toMatchObject({
      bean: 'b1',
      state: 'promoted',
      title: 'One',
      landed_sha: 'a'.repeat(40),
    });
    expect(stalk.days[0]).toMatchObject({ landed: 1, promoted: 1 });
    expect(stalk.activity.filter((line) => line.kind === 'landed')).toHaveLength(1);
  });

  it('acks a message for an engine no repository owns, and drops one that is not an event', async () => {
    const result = await consume([
      message('rffffffffffffffffff', [
        event({ seq: 1, kind: 'bean.opened', bean: 'x', title: '', actor: null }),
      ]),
      { id: 'bad', timestamp: new Date(), attempts: 1, body: { v: 1, engine: 'x', events: [] } },
    ]);
    expect(result.explicitAcks.toSorted()).toEqual(['bad', 'm-rffffffffffffffffff'].toSorted());
    expect(result.retryMessages).toEqual([]);
  });

  it('keeps decision cards: asked, then answered by a person', async () => {
    const record = value(
      await gateway.createRepository(coop, {
        name: 'cards',
        visibility: 'private',
        start: { kind: 'empty' },
      }),
    );
    await consume([
      message(record.engine_id, [
        event({
          seq: 3,
          kind: 'decision.asked',
          card: 'c1',
          bean: 'b2',
          against: ['b1'],
          reason: null,
        }),
        event({
          seq: 4,
          kind: 'decision.made',
          card: 'c1',
          winner: 'b2',
          loser: 'b1',
          by: 'human:ev-coop',
        }),
      ]),
    ]);
    const row = await env.FORGE.prepare(
      'SELECT state, winner, decided_by FROM decisions WHERE repo_id = ?',
    )
      .bind(record.id)
      .first();
    expect(row).toEqual({ state: 'decided', winner: 'b2', decided_by: 'human:ev-coop' });
    const activity = value(await gateway.repositoryStalk(record.id, coop.id)).activity;
    expect(activity[0]?.text).toBe('Decided: b2 over b1, by @ev-coop.');
  });
});

// Helpers ----------------------------------------------------------------------------------

type EventInput = {
  [K in RepoEvent['kind']]: Omit<Extract<RepoEvent, { kind: K }>, 'at'>;
}[RepoEvent['kind']];

function event(input: EventInput): RepoEvent {
  return { ...input, at: new Date(Date.UTC(2026, 9, 7, 12, 0, input.seq)).toISOString() };
}

function message(engine: string, events: readonly RepoEvent[]) {
  const body: RepoEventsMessage = { v: 1, engine, events: [...events] };
  return { id: `m-${engine}`, timestamp: new Date(), attempts: 1, body };
}

/** The consumer on a hand-made batch, as the queue would call it; then each message's fate. */
async function consume(messages: Parameters<typeof createMessageBatch>[1]) {
  const batch = createMessageBatch('beanstalk-repo-events', messages);
  await consumeRepoEvents(batch, {
    db: env.FORGE,
    registry: d1Registry(env.FORGE),
    log: createLogger('error'),
  });
  return getQueueResult(batch, createExecutionContext());
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

function push(
  record: RepositoryRecord,
  token: string,
  branch: string,
  newSha: string,
  subject: string,
): Promise<Response> {
  const commits = { [newSha]: { message: subject, parents: [], files: {} } };
  const body = `${pkt(`${ZERO} ${newSha} refs/heads/${branch}\0report-status side-band-64k\n`)}0000PACK${JSON.stringify({ commits })}`;
  return call('POST', `/git/${record.owner.handle}/${record.name}.git/git-receive-pack`, {
    token,
    body,
    headers: {
      'content-type': 'application/x-git-receive-pack-request',
      accept: 'application/x-git-receive-pack-result',
    },
  });
}

function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
