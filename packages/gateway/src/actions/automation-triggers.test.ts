import { describe, expect, it } from 'vitest';

import type { WorkflowTrigger } from '@gitstalk/shared-race/actions';
import type { RepoEvent } from '@gitstalk/shared-race/repo-events';

import { automationFires, occurrenceOf, occurrencePayload } from './automation-triggers';

const AT = '2026-10-09T10:00:00.000Z';
const RED: RepoEvent = { seq: 7, at: AT, kind: 'bean.rework', bean: 'fix-login', reason: 'red' };
const LANDED: RepoEvent = {
  seq: 8,
  at: AT,
  kind: 'bean.landed',
  bean: 'add-total',
  sha: 'a'.repeat(40),
  trunk_idx: 3,
  files: 2,
  actor: 'dana',
};

function on(
  event: Extract<WorkflowTrigger, { kind: 'beanstalk' }>['event'],
  filters: { beans?: string[]; authors?: string[] } = {},
): WorkflowTrigger[] {
  return [{ kind: 'beanstalk', event, beans: filters.beans ?? [], authors: filters.authors ?? [] }];
}

describe('which automations a repository event starts', () => {
  it('maps every repository event to its Gitstalk event', () => {
    expect(occurrenceOf(RED)).toMatchObject({ event: 'bean_red', bean: 'fix-login', sha: null });
    expect(occurrenceOf(LANDED)).toMatchObject({
      event: 'bean_landed',
      actor: 'dana',
      sha: 'a'.repeat(40),
    });
    expect(
      occurrenceOf({ seq: 1, at: AT, kind: 'stalk.promoted', sha: 'b', trunk_idx: 1, beans: [] }),
    ).toMatchObject({ event: 'stalk_moved', sha: 'b' });
    expect(
      occurrenceOf({
        seq: 2,
        at: AT,
        kind: 'bean.ended',
        bean: 'x',
        outcome: 'parked',
        reason: '',
      }).event,
    ).toBe('bean_parked');
    expect(
      occurrenceOf({
        seq: 3,
        at: AT,
        kind: 'decision.made',
        card: 'c1',
        winner: 'w',
        loser: 'l',
        by: 'human:coop',
      }),
    ).toMatchObject({ event: 'decision_decided', actor: 'coop', bean: 'w' });
  });

  it('fires on the named event only, through the bean and author filters', () => {
    const red = occurrenceOf(RED);
    expect(automationFires(on('bean_red'), red, 'fix[automation]')).toBe(true);
    expect(automationFires(on('bean_landed'), red, 'fix[automation]')).toBe(false);
    expect(automationFires(on('bean_red', { beans: ['fix-*'] }), red, 'a')).toBe(true);
    expect(automationFires(on('bean_red', { beans: ['fix-*', '!fix-login'] }), red, 'a')).toBe(
      false,
    );
    const landed = occurrenceOf(LANDED);
    expect(automationFires(on('bean_landed', { authors: ['dana'] }), landed, 'a')).toBe(true);
    expect(automationFires(on('bean_landed', { authors: ['coop'] }), landed, 'a')).toBe(false);
    expect(automationFires(on('bean_red', { authors: ['dana'] }), red, 'a')).toBe(false);
  });

  it('never fires on the automation’s own beans', () => {
    const own = { ...occurrenceOf(LANDED), actor: 'fix[automation]' };
    expect(automationFires(on('bean_landed'), own, 'fix[automation]')).toBe(false);
    expect(automationFires(on('bean_landed'), own, 'other[automation]')).toBe(true);
  });

  it('puts the event in the payload as data, with the bean’s branch', () => {
    const payload = occurrencePayload({
      repo: {
        id: 'r1',
        ownerId: 'u1',
        ownerHandle: 'coop',
        name: 'shop',
        engineId: 'e1',
        defaultBranch: 'main',
        visibility: 'private',
      },
      publicUrl: 'https://beanstalk.example',
      occurrence: occurrenceOf(RED),
    });
    expect(payload).toMatchObject({
      action: 'bean_red',
      beanstalk: {
        event: 'bean_red',
        bean: 'fix-login',
        bean_ref: 'refs/heads/bean/fix-login',
        detail: { kind: 'bean.rework', reason: 'red' },
      },
      repository: { full_name: 'coop/shop' },
    });
  });
});
