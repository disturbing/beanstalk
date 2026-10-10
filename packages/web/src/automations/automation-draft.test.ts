import { describe, expect, it } from 'vitest';

import { readAutomationFile } from '@gitstalk/shared-race/automation-file';

import {
  formOf,
  readDraft,
  setCrons,
  setEvent,
  setEventFilter,
  setField,
} from './automation-draft';
import { AUTOMATION_TEMPLATES } from './templates';

const LIMITS = { maxTimeoutMinutes: 60 };
const FILE = `# Fixes red beans.
name: Fix red beans
on:
  bean_red:
    beans: ['*', '!fix-*']   # not its own fixes
permissions:
  beans: write
max-cost-usd: 0.5
prompt: |
  Read why the bean went red.
  Fix it in a new bean.
`;

describe('the YAML round trip', () => {
  it('reads the form from the file', () => {
    const parsed = readDraft(FILE);
    if (parsed.kind !== 'ok') throw new Error('expected YAML');
    expect(formOf(parsed.value)).toMatchObject({
      name: 'Fix red beans',
      events: { bean_red: { beans: ['*', '!fix-*'], authors: [] } },
      crons: [],
      harness: 'agent',
      beansWrite: true,
      maxCostUsd: 0.5,
      memory: true,
      prompt: 'Read why the bean went red.\nFix it in a new bean.\n',
    });
  });

  it('changes one field and keeps every comment, key order and the other lines', () => {
    const next = setField(FILE, ['name'], 'Fix red beans fast');
    expect(next).toBe(FILE.replace('name: Fix red beans', 'name: Fix red beans fast'));
  });

  it('writes a number in place without touching the prompt block', () => {
    const next = setField(FILE, ['max-cost-usd'], 1.25);
    expect(next).toBe(FILE.replace('max-cost-usd: 0.5', 'max-cost-usd: 1.25'));
  });

  it('keeps a multi-line prompt as a block', () => {
    const next = setField(FILE, ['prompt'], 'Line one.\nLine two.\n');
    expect(next).toContain('prompt: |\n  Line one.\n  Line two.\n');
    expect(next).toContain('# not its own fixes');
  });

  it('adds a missing key at the end and removes one, leaving the rest as written', () => {
    const added = setField(FILE, ['timeout-minutes'], 20);
    expect(added.startsWith(FILE.trimEnd().split('prompt:')[0] ?? '')).toBe(true);
    expect(added).toContain('timeout-minutes: 20');
    expect(setField(added, ['timeout-minutes'], undefined)).toBe(FILE);
  });

  it('adds a schedule beside the event and the manual fallback when the last trigger goes', () => {
    const scheduled = setCrons(FILE, ['0 9 * * 1']);
    expect(scheduled).toContain('schedule: [ { cron: "0 9 * * 1" } ]');
    const parsed = readDraft(setEvent(setCrons(scheduled, []), 'bean_red', false));
    if (parsed.kind !== 'ok') throw new Error('expected YAML');
    expect(parsed.value['on']).toEqual({ workflow_dispatch: null });
  });

  it('turns `on: <name>` into a mapping when a filter is added', () => {
    const short = 'name: X\non: bean_landed\nprompt: go\n';
    const next = setEventFilter(short, 'bean_landed', { beans: ['release-*'], authors: [] });
    const parsed = readDraft(next);
    if (parsed.kind !== 'ok') throw new Error('expected YAML');
    expect(parsed.value['on']).toEqual({ bean_landed: { beans: ['release-*'] } });
  });

  it('adds a trigger inside a 4-space mapping at its indentation, other lines untouched', () => {
    const wide = 'name: W\non:\n    bean_red:\n        beans: ["*"]   # all\nprompt: go\n';
    const next = setCrons(wide, ['0 9 * * *']);
    expect(next).toBe(
      'name: W\non:\n    bean_red:\n        beans: ["*"]   # all\n    schedule: [ { cron: "0 9 * * *" } ]\nprompt: go\n',
    );
  });

  it('writes a bare event as `event:`, never `event: null`', () => {
    expect(setEvent(FILE, 'stalk_moved', true)).toContain('  stalk_moved:\n');
  });

  it('reports syntax errors with their line and leaves such text alone', () => {
    const broken = 'name: X\non:\n  bean_red: [\nprompt: y\n';
    const parsed = readDraft(broken);
    expect(parsed.kind).toBe('syntax');
    if (parsed.kind === 'syntax') expect(parsed.errors[0]?.line).toBeGreaterThan(1);
    expect(setField(broken, ['name'], 'Y')).toBe(broken);
  });

  it('keeps every edit valid by the gateway’s own validator', () => {
    const edited = setEventFilter(
      setCrons(setField(FILE, ['secrets'], ['LINEAR_KEY']), ['*/30 * * * *']),
      'bean_red',
      { beans: ['*'], authors: ['coop'] },
    );
    expect(
      readAutomationFile('.beanstalk/automations/fix-red.yml', edited, LIMITS).problems,
    ).toEqual([]);
  });
});

describe('templates', () => {
  it.each(AUTOMATION_TEMPLATES)('$title is a valid automation as written', (template) => {
    const file = readAutomationFile(
      `.beanstalk/automations/${template.file}`,
      template.source,
      LIMITS,
    );
    expect(file.problems).toEqual([]);
  });
});
