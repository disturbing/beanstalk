import { describe, expect, it } from 'vitest';

import { MAX_TASKS, parseBacklog } from './backlog';

describe('parseBacklog', () => {
  it('reads tagged and untagged tasks with their detail and ticks', () => {
    const tasks = parseBacklog(
      [
        '# Backlog',
        '',
        '- [ ] add-total: Add a total helper',
        '  Sum the line items; keep it pure.',
        '',
        '  Round to cents.',
        '- [x] T-2: Rename the cart module',
        '* [ ] Show prices in euros!',
        'Some prose that is not a task.',
        '- a plain bullet, not a task',
      ].join('\n'),
    );
    expect(tasks).toEqual([
      {
        id: 'add-total',
        title: 'Add a total helper',
        detail: 'Sum the line items; keep it pure.\n\nRound to cents.',
        isTicked: false,
      },
      { id: 'T-2', title: 'Rename the cart module', detail: '', isTicked: true },
      { id: 'show-prices-in-euros', title: 'Show prices in euros!', detail: '', isTicked: false },
    ]);
  });

  it('makes repeated ids unique and accepts bracketed ids', () => {
    const tasks = parseBacklog('- [ ] [BUG-7]: Fix it\n- [ ] Fix it\n- [ ] Fix it');
    expect(tasks.map((task) => task.id)).toEqual(['BUG-7', 'fix-it', 'fix-it-2']);
  });

  it('reads at most MAX_TASKS tasks', () => {
    const many = Array.from({ length: MAX_TASKS + 5 }, (_, index) => `- [ ] t${index}: Task`);
    expect(parseBacklog(many.join('\n'))).toHaveLength(MAX_TASKS);
  });

  it('finds no tasks in a file without checkboxes', () => {
    expect(parseBacklog('# Notes\n\n- one\n- two\n')).toEqual([]);
  });
});
