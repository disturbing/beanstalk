import { describe, expect, it } from 'vitest';

import type { Step } from './actions-contract';
import { parseAnsi, stripAnsi } from './ansi';
import { appendLines, groupByStep, plainLog, searchLines, workflowCommand } from './log-view';

const ESC = '\u001b[';

function step(number: number, name: string): Step {
  return { number, name, status: 'completed', conclusion: 'success', startedAt: null, completedAt: null };
}

describe('ANSI colour', () => {
  it('splits a line into styled runs and resets on 0', () => {
    const runs = parseAnsi(`${ESC}1;32m✓${ESC}0m passed ${ESC}31mred${ESC}39m`);
    expect(runs.map((run) => run.text)).toEqual(['✓', ' passed ', 'red']);
    expect(runs[0]?.style).toMatchObject({ bold: true, fg: { kind: 'named', name: 'green' } });
    expect(runs[1]?.style.fg).toBeNull();
    expect(runs[2]?.style.fg).toEqual({ kind: 'named', name: 'red', bright: false });
  });

  it('reads 256-colour and true-colour values', () => {
    const [cube, rgb] = parseAnsi(`${ESC}38;5;196ma${ESC}38;2;10;20;300mb`);
    expect(cube?.style.fg).toEqual({ kind: 'rgb', css: 'rgb(255, 0, 0)' });
    expect(rgb?.style.fg).toEqual({ kind: 'rgb', css: 'rgb(10, 20, 255)' });
  });

  it('drops cursor moves, line clears and OSC titles, keeping the text', () => {
    const line = `${ESC}2K${ESC}1Gnpm ${ESC}1A\u001b]0;title\u0007install`;
    expect(stripAnsi(line)).toBe('npm install');
    expect(parseAnsi(line).map((run) => run.text).join('')).toBe('npm install');
  });
});

describe('a job log', () => {
  const steps = [step(1, 'Set up job'), step(2, 'npm test')];
  const lines = [
    { n: 1, step: 1, text: 'Image: ubuntu-24.04' },
    { n: 2, step: 2, text: `${ESC}32m✓${ESC}39m test/cart.test.ts` },
    { n: 3, step: 2, text: `${ESC}31m✗${ESC}39m test/tax.test.ts` },
  ];

  it('groups lines under their steps, a step without lines empty', () => {
    const groups = groupByStep([...steps, step(3, 'Complete job')], lines);
    expect(groups.map((group) => group.lines.length)).toEqual([1, 2, 0]);
  });

  it('appends only lines after the last one it has', () => {
    const current = lines.slice(0, 2);
    expect(appendLines(current, lines).map((line) => line.n)).toEqual([1, 2, 3]);
    expect(appendLines(lines, lines.slice(1))).toBe(lines);
  });

  it('searches the text without its colours, ignoring case', () => {
    expect(searchLines(lines, 'TEST/')).toEqual([2, 3]);
    expect(searchLines(lines, '32m')).toEqual([]);
    expect(searchLines(lines, '  ')).toEqual([]);
  });

  it('reads a workflow command as an annotation', () => {
    expect(workflowCommand('::error file=test/tax.test.ts,line=27::expected 4.35 to be 4.5')).toEqual({
      level: 'error',
      message: 'expected 4.35 to be 4.5',
      path: 'test/tax.test.ts',
      line: 27,
    });
    expect(workflowCommand('::warning::slow')).toMatchObject({ level: 'warning', path: null });
    expect(workflowCommand('plain line')).toBeNull();
  });

  it('downloads as plain text grouped by step', () => {
    expect(plainLog(steps, lines)).toBe(
      '##[group]Set up job\nImage: ubuntu-24.04\n##[endgroup]\n##[group]npm test\n✓ test/cart.test.ts\n✗ test/tax.test.ts\n##[endgroup]',
    );
  });
});
