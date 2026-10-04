import { describe, expect, it } from 'vitest';

import type { JevRunner, PickDecision } from './picker';
import { jevPicker, rulesPicker } from './picker';

const decision: PickDecision = {
  id: 'lead',
  title: 'Lead the page',
  ask: 'Which fact first?',
  state: { run: 'finished' },
  candidates: [
    { id: 'growth', description: 'how far it grew', label: 'Growth' },
    { id: 'decision', description: 'a decision', label: 'Decision' },
    { id: 'drops', description: 'what fell off', label: 'Drops' },
  ],
  slots: 2,
  rule: () => ({ chosen: ['growth', 'decision', 'drops'], why: 'Rule: growth first.' }),
};

function runner(answer: unknown): JevRunner {
  return { run: () => Promise.resolve(answer) };
}

const options = { model: 'typesafe/jev', gateway: 'default', budgetMs: 200 } as const;

describe('the rules picker', () => {
  it('keeps the rule order, cut to the slots', async () => {
    const receipt = await rulesPicker.decide(decision);
    expect(receipt.chosen).toEqual(['growth', 'decision']);
    expect(receipt.by).toBe('rules');
    expect(receipt.why).toBe('Rule: growth first.');
  });
});

describe('the Jev picker', () => {
  it("puts Jev's choice first and orders the rest by probability", async () => {
    const answer = {
      answers: {
        pick: {
          choice: 'drops',
          confidence: 0.7,
          probabilities: { drops: 0.7, decision: 0.2, growth: 0.1 },
        },
      },
    };
    const receipt = await jevPicker(runner(answer), options).decide(decision);
    expect(receipt.chosen).toEqual(['drops', 'decision']);
    expect(receipt.by).toBe('jev');
    expect(receipt.confidence).toBe(0.7);
  });

  it('reads the answer wrapped the way the REST API returns it', async () => {
    const answer = { result: { result: { answers: { pick: { choice: 'decision' } } } } };
    const receipt = await jevPicker(runner(answer), options).decide(decision);
    expect(receipt.chosen[0]).toBe('decision');
  });

  it('falls back to the rule when Jev picks something outside the candidates', async () => {
    const answer = { answers: { pick: { choice: 'launch-the-missiles' } } };
    const receipt = await jevPicker(runner(answer), options).decide(decision);
    expect(receipt.by).toBe('rules');
    expect(receipt.chosen).toEqual(['growth', 'decision']);
    expect(receipt.why).toContain('not a candidate');
  });

  it('falls back to the rule when Jev does not answer within the budget', async () => {
    const slow: JevRunner = { run: () => new Promise(() => undefined) };
    const receipt = await jevPicker(slow, { ...options, budgetMs: 20 }).decide(decision);
    expect(receipt.by).toBe('rules');
    expect(receipt.why).toContain('no answer within 20 ms');
  });

  it('sends the candidates as a choice question through the named gateway', async () => {
    const calls: unknown[] = [];
    const spy: JevRunner = {
      run: (model, input, gateway) => {
        calls.push({ model, input, gateway });
        return Promise.resolve({ answers: { pick: { choice: 'growth' } } });
      },
    };
    await jevPicker(spy, options).decide(decision);
    expect(calls).toEqual([
      {
        model: 'typesafe/jev',
        input: {
          state: { run: 'finished' },
          questions: {
            pick: {
              type: 'choice',
              instructions: 'Which fact first?',
              criteria: {
                growth: 'how far it grew',
                decision: 'a decision',
                drops: 'what fell off',
              },
            },
          },
        },
        gateway: { gateway: { id: 'default' } },
      },
    ]);
  });
});
