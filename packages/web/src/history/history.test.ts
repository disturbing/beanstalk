import { describe, expect, it } from 'vitest';

import {
  GREETER_EVENTS,
  GREETER_PUSHED,
  ROOT,
  SLUGIFY_LANDED,
  TRUNCATE_LANDED,
} from '../changes/testing/greeter';
import type { LogCommit } from './history';
import { historyOf, landingsOf, trailerTask } from './history';

const runner = { name: 'beanstalk-runner', email: 'runner@beanstalk.invalid' };

function commit(sha: string, parent: string | null, message: string, at: string): LogCommit {
  return {
    sha,
    parents: parent === null ? [] : [parent],
    message,
    author: runner,
    committed_at: at,
  };
}

const root = commit(ROOT, null, 'Start from the TypeScript starter', '2026-10-07T13:39:40Z');
const truncate = commit(
  TRUNCATE_LANDED,
  ROOT,
  'Add truncate for long titles\n\nTask: add-truncate',
  '2026-10-07T13:40:44Z',
);
const slugify = commit(
  SLUGIFY_LANDED,
  TRUNCATE_LANDED,
  'Add slugify for bean names\n\nTask: slugify',
  '2026-10-07T13:41:19Z',
);

describe('the History tab', () => {
  it('lists the stalk newest first, each commit with its bean and the person who pushed it', () => {
    const history = historyOf({
      stalk: [
        slugify,
        truncate,
        { ...root, author: { name: 'Beanstalk', email: 'seed@beanstalk.invalid' } },
      ],
      sprout: [slugify, truncate, root],
      pushed: GREETER_PUSHED,
      landings: landingsOf(GREETER_EVENTS),
    });
    expect(history.pending).toEqual([]);
    expect(history.stalk.map((row) => [row.title, row.bean, row.by.name, row.root])).toEqual([
      ['Add slugify for bean names', 'slugify', 'coop', false],
      ['Add truncate for long titles', 'add-truncate', 'coop', false],
      ['Start from the TypeScript starter', null, 'Beanstalk', true],
    ]);
    expect(history.stalk[0]?.by.kind).toBe('person');
  });

  it('marks sprout commits that are not validated yet, above the stalk', () => {
    const history = historyOf({
      stalk: [truncate, root],
      sprout: [slugify, truncate, root],
      pushed: GREETER_PUSHED,
      landings: new Map(),
    });
    expect(history.pending.map((row) => row.bean)).toEqual(['slugify']);
    expect(history.stalk).toHaveLength(2);
  });

  it('finds the bean from the engine’s landings or the Task trailer', () => {
    expect(landingsOf(GREETER_EVENTS).get(TRUNCATE_LANDED)).toBe('add-truncate');
    expect(trailerTask('Fix it\n\nTask: t042\nPolicy: beanstalk')).toBe('t042');
    expect(trailerTask('No trailer here')).toBeNull();
  });
});
