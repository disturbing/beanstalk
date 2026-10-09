import { describe, expect, it } from 'vitest';

import type { Feed, FeedItem } from './home-activity';
import { activityLines, indexLines, latestPerBean, readEngineFeeds } from './home-activity';
import type { RepositoryRecord } from './registry-client';

const record: RepositoryRecord = {
  id: 'bur44dmjamg3',
  owner: { id: 'u1', handle: 'coop' },
  owner_kind: 'user',
  name: 'greeter',
  description: '',
  visibility: 'private',
  origin: { kind: 'template', template: 'typescript-starter' },
  artifacts_repo: 'repo-bur44dmjamg3',
  engine_id: 'r281f4071a6a622cb597',
  default_branch: 'stalk',
  created_at: '2026-10-07T13:39:40Z',
  updated_at: '2026-10-07T13:39:40Z',
  archived_at: null,
  website: '',
  topics: [],
  social_image_key: null,
};

function item(seq: number, kind: FeedItem['kind'], bean: string, detail = ''): FeedItem {
  const at = new Date(Date.UTC(2026, 9, 7, 13, 40, seq)).toISOString();
  return { seq, at, kind, bean, title: `About ${bean}`, actor: 'coop', detail };
}

describe('Home activity from the engines', () => {
  it('keeps a bean’s newest line, and reds, but not the push and landing a validation implies', () => {
    const items = [
      item(9, 'validated', 'slugify', '8dadcc9'),
      item(8, 'landed', 'slugify', '8dadcc9'),
      item(7, 'pushed', 'slugify'),
      item(6, 'red', 'shout', 'test/shout.test.ts > shout adds an exclamation mark'),
      item(5, 'pushed', 'shout'),
    ];
    expect(latestPerBean(items).map((line) => `${line.kind} ${line.bean ?? ''}`)).toEqual([
      'validated slugify',
      'red shout',
    ]);
  });

  it('merges engine lines with the registry’s, newest first, in sentences', () => {
    const feeds = new Map<string, Feed>([
      [
        record.engine_id,
        {
          engine_id: record.engine_id,
          tasks: { green: 1, rework: 1 },
          items: [
            item(9, 'validated', 'slugify', '8dadcc9'),
            item(6, 'red', 'shout', 'test/shout.test.ts > shout adds an exclamation mark'),
          ],
        },
      ],
    ]);
    const lines = activityLines({
      records: [record],
      registry: [
        {
          repo_id: record.id,
          owner_handle: 'coop',
          repo_name: 'greeter',
          at: '2026-10-07T13:39:40Z',
          kind: 'created',
          text: 'Created from the TypeScript starter.',
          bean: null,
          sha: null,
        },
      ],
      feeds,
      limit: 10,
    });
    expect(lines.map((line) => [line.tone, line.bean, line.text])).toEqual([
      ['good', 'slugify', 'reached the stalk: “About slugify”, pushed by @coop'],
      ['bad', 'shout', 'went red: test/shout.test.ts > shout adds an exclamation mark failed'],
      ['neutral', null, 'Created from the TypeScript starter.'],
    ]);
  });

  it('reads no feeds from a gateway without engineFeeds, or from a failed call', async () => {
    expect((await readEngineFeeds({}, ['r1'])).size).toBe(0);
    const failing = { engineFeeds: () => Promise.reject(new Error('down')) };
    expect((await readEngineFeeds(failing, ['r1'])).size).toBe(0);
    const answering = {
      engineFeeds: (ids: string[]) =>
        Promise.resolve({
          ok: true,
          value: ids.map((id) => ({ engine_id: id, tasks: {}, items: [] })),
        }),
    };
    expect([...(await readEngineFeeds(answering, ['r1', 'r2'])).keys()]).toEqual(['r1', 'r2']);
  });
});

describe('Home activity from the repo-events index', () => {
  const line = (kind: string, bean: string | null, text: string, second: number) => ({
    repo_id: record.id,
    owner_handle: 'coop',
    repo_name: 'greeter',
    at: new Date(Date.UTC(2026, 9, 7, 14, 0, second)).toISOString(),
    kind,
    text,
    bean,
    sha: null,
  });

  it('links each bean, and keeps only its newest step', () => {
    const lines = indexLines([
      line('promoted', 'add-truncate', 'The stalk moved to 75c0ebb: add-truncate validated.', 9),
      line('landed', 'add-truncate', 'add-truncate landed on the sprout at 75c0ebb.', 5),
      line('opened', 'add-truncate', '@coop pushed bean add-truncate: Add truncate.', 1),
      line('rework', 'shout', 'shout went back to its author: red.', 4),
      line('created', null, 'Created from the TypeScript starter.', 0),
    ]);
    expect(lines.map((each) => [each.tone, each.bean, each.text])).toEqual([
      ['good', null, 'The stalk moved to 75c0ebb: add-truncate validated.'],
      ['neutral', 'shout', 'went back to its author: red.'],
      ['neutral', null, 'Created from the TypeScript starter.'],
    ]);
  });
});
