import { describe, expect, it } from 'vitest';

import { RunId } from '@beanstalk/shared-race/ids';

import { recordedSource } from '../forge/recorded-source';
import { textLines } from '@beanstalk/shared-ask/repo/file-diff';
import type { Answer } from '@beanstalk/shared-ask/ask/answer';
import { keywordClassifier } from '@beanstalk/shared-ask/ask/classifier';
import { planAnswer } from '@beanstalk/shared-ask/ask/plan-answer';

const v2 = RunId.parse('7z4j84eqvl');
const queue = RunId.parse('u0ntf65lbe');
const noSelection = { file: null, bean: null, view: null } as const;

function ask(
  question: string,
  options: {
    readonly asOf?: number;
    readonly removed?: readonly string[];
    readonly run?: RunId;
  } = {},
): Promise<Answer> {
  return planAnswer({
    source: recordedSource(options.asOf === undefined ? {} : { asOf: options.asOf }),
    run: options.run ?? v2,
    question,
    classifier: keywordClassifier,
    removed: options.removed ?? [],
    ref: null,
    selection: noSelection,
  });
}

describe('asking the recorded v2 run', () => {
  it('answers "what changed recently on coupons?" with a filtered tree and a combined diff', async () => {
    const answer = await ask('what changed recently on coupons?');
    expect(answer.spec.class).toBe('recent-changes');
    expect(answer.tree.mode).toBe('filtered');
    expect(answer.tree.files).toContain('src/billing/coupons.ts');
    expect(answer.main.kind).toBe('diff');
    if (answer.main.kind === 'diff') {
      expect(answer.main.diff.files.map((file) => file.path)).toContain('src/billing/coupons.ts');
      expect(answer.main.fromLabel).toBe('base');
    }
    const beans = answer.rail.find((block) => block.kind === 'beans');
    expect(beans?.kind === 'beans' && beans.beans.map((bean) => bean.id).slice(0, 3)).toEqual(
      expect.arrayContaining(['t015', 't024']),
    );
  });

  it('shows the parsed question as chips and widens when a chip is removed', async () => {
    const narrow = await ask('what changed recently on coupons?');
    expect(narrow.chips[0]).toEqual({ id: 'feature', kind: 'feature', label: 'coupons' });
    expect(narrow.chips.some((chip) => chip.id === 'file:src/billing/coupons.ts')).toBe(true);
    const wide = await ask('what changed recently on coupons?', { removed: ['feature'] });
    expect(wide.chips).toEqual([]);
    expect(wide.tree.files.length).toBeGreaterThan(narrow.tree.files.length);
  });

  it('prunes one resolved file without losing the rest', async () => {
    const pruned = await ask('what changed recently on coupons?', {
      removed: ['file:src/billing/coupons.ts'],
    });
    expect(pruned.tree.files).not.toContain('src/billing/coupons.ts');
    expect(pruned.tree.files).toContain('src/billing/coupons.test.ts');
  });

  it('blames tax.ts line by line on the beans that changed it', async () => {
    const answer = await ask('who changed tax rounding and why?');
    expect(answer.main.kind).toBe('file');
    if (answer.main.kind === 'file') {
      expect(answer.main.title).toBe('src/billing/tax.ts');
      expect(answer.main.blame).toHaveLength(textLines(answer.main.file.text).length);
      expect(new Set(answer.main.blame?.map((line) => line.task))).toEqual(
        new Set([null, 't003', 't017']),
      );
    }
  });

  it('travels back to minute 10: billing work in flight and commits waiting for the stalk', async () => {
    const inFlight = await ask("what's being worked on in billing right now?", { asOf: 600 });
    expect(inFlight.main.kind).toBe('bean');
    expect(inFlight.rail.find((block) => block.kind === 'agents')).toMatchObject({
      kind: 'agents',
    });
    const waiting = await ask("what's on sprout but not on stalk?", { asOf: 600 });
    expect(waiting.headline).toBe('6 commits on the sprout wait for the stalk.');
    expect(waiting.main.kind).toBe('diff');
  });

  it('says the stalk has everything once the run is over', async () => {
    const answer = await ask("what's on sprout but not on stalk?");
    expect(answer.main).toEqual({
      kind: 'empty',
      title: 'Waiting for the stalk',
      message: 'The stalk has everything on the sprout.',
    });
  });

  it('traces the red sprout to the repair ticket culprit t018 and the failing test', async () => {
    const answer = await ask('why did the sprout go red?');
    expect(answer.tree.files).toEqual([
      'src/notifications/templates.ts',
      'src/notifications/tracking-email.test.ts',
    ]);
    expect(answer.main.kind === 'bean' && answer.main.bean.id).toBe('t018');
    const red = answer.rail.find((block) => block.kind === 'red');
    expect(red?.kind === 'red' && red.tickets.map((ticket) => ticket.culprit)).toEqual(['t018']);
  });

  it('opens the test that encodes the winning spec of decision D001', async () => {
    const answer = await ask('what did we decide about money formatting?');
    expect(answer.main.kind === 'file' && answer.main.title).toBe(
      'src/orders/confirmation-grouping.test.ts',
    );
    const cards = answer.rail.find((block) => block.kind === 'decisions');
    expect(cards?.kind === 'decisions' && cards.cards[0]?.winner).toBe('t005');
  });

  it('lists the code and the tests that cover checkout', async () => {
    const answer = await ask('what tests cover checkout?');
    expect(answer.tree.files[0]).toBe('src/orders/checkout.ts');
    expect(answer.tree.files).toContain('src/orders/checkout-rollback.test.ts');
    expect(answer.main.kind === 'file' && answer.main.title.endsWith('.test.ts')).toBe(true);
  });

  it('shows a dropped bean with its own diff and its checks', async () => {
    const answer = await ask('show bean t032');
    expect(answer.main.kind === 'bean' && answer.main.bean.status).toBe('dropped');
    expect(answer.main.kind === 'bean' && answer.main.diff?.files.length).toBe(4);
    expect(answer.rail.map((block) => block.kind)).toEqual(['checks', 'decisions']);
  });

  it('falls back to the plain explorer for an empty question', async () => {
    const answer = await ask('');
    expect(answer.spec.class).toBe('explore');
    expect(answer.tree.mode).toBe('full');
    expect(answer.main.kind === 'file' && answer.main.title).toBe('README.md');
  });
});

describe('asking the recorded queue run', () => {
  it('calls its only line the stalk and blames the bisection culprits', async () => {
    const answer = await ask('why did the stalk go red?', { run: queue });
    expect(answer.ref.name).toBe('stalk');
    const red = answer.rail.find((block) => block.kind === 'red');
    expect(red?.kind === 'red' && red.culprits.length).toBe(9);
  });
});
