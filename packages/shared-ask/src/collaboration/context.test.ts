import { describe, expect, it } from 'vitest';

import {
  BeanContext,
  BeanPromise,
  BeanReliance,
  ThreadPost,
} from '@gitstalk/shared-race/collaboration';

import { TaskId } from '@gitstalk/shared-race/ids';

import { selectCollaborationContext } from './context';
import type { PeerContext } from './context';

const NOW = '2026-10-06T12:00:00.000Z';

function context(
  bean: string,
  intent: string = '',
  changes: Partial<Omit<BeanContext, 'bean'>> = {},
): BeanContext {
  return BeanContext.parse({
    bean: { bean, revision: 3, intent, approach: null, actor: null, updated_at: NOW },
    promises: [],
    referenced_promises: [],
    reliance: [],
    history: [],
    next_cursor: 11,
    current_cursor: 11,
    truncated: false,
    ...changes,
  });
}

function reliance(bean: string, revision: number = 1): BeanReliance {
  return BeanReliance.parse({
    bean,
    promise: 'delivery-estimate',
    revision,
    actor: 'local-codex',
    recorded_at: NOW,
    accepted_event: null,
    source: { bean: 'emails', revision: 3, event_id: 5 },
  });
}

function request(author: string, bean: string, eventId: number = 7): ThreadPost {
  return ThreadPost.parse({
    event_id: eventId,
    bean,
    author_bean: author,
    actor: 'local-claude',
    thread: 'compatibility',
    kind: 'request',
    body: 'Could you preserve the existing interface?',
    references: [],
    reply_to: null,
    created_at: NOW,
  });
}

describe('bean collaboration context', () => {
  it('preserves exact pinned revisions before higher lexical matches', () => {
    const pinned = reliance('estimates', 1);
    const focus = context('emails', 'Send shipment business-day estimates', { reliance: [pinned] });
    const result = selectCollaborationContext({
      focus,
      candidates: [
        { context: context('templates', 'Send shipment business-day estimates') },
        { context: context('estimates', 'Calendar compatibility') },
      ],
      limit: 1,
    });
    expect(result.related.map((entry) => entry.bean)).toEqual(['estimates']);
    expect(result.related[0]?.promise_references).toEqual([
      { bean: 'estimates', promise: 'delivery-estimate', revision: 1 },
    ]);
    expect(result.related[0]?.reasons).toContain('promise-reference');
    expect(result.omitted).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it('keeps directly addressed requests when the author has no matching words', () => {
    const post = request('migrations', 'emails');
    const focus = context('emails', 'Send shipment messages', {
      history: [{ kind: 'thread.posted', event_id: post.event_id, post }],
    });
    const result = selectCollaborationContext({
      focus,
      candidates: [{ context: context('migrations', 'Database compatibility') }],
    });
    expect(result.related[0]?.reasons).toEqual(['direct-request']);
    expect(result.related[0]?.request_events).toEqual([7]);
    expect(result.related[0]?.score).toBe(0);
  });

  it('shows a newer offer without silently advancing an existing pinned promise', () => {
    const original = BeanPromise.parse({
      id: 'delivery-estimate',
      bean: 'estimates',
      revision: 1,
      body: 'days counts calendar days',
      conditions: '',
      paths: [],
      actor: 'local-claude',
      offered_at: NOW,
      source: { bean: 'estimates', revision: 1, event_id: 2 },
    });
    const revised = { ...original, revision: 2, body: 'days counts business days' };
    const result = selectCollaborationContext({
      focus: context('emails', 'Send messages', {
        reliance: [reliance('estimates')],
        referenced_promises: [original],
      }),
      candidates: [{ context: context('estimates', 'Calculate dates', { promises: [revised] }) }],
    });
    expect(result.related[0]?.promise_references[0]?.revision).toBe(1);
    expect(result.related[0]?.promise_statuses).toEqual([
      {
        reference: { bean: 'estimates', promise: 'delivery-estimate', revision: 1 },
        current_revision: 2,
        status: 'superseded',
      },
    ]);
  });

  it('puts addressed requests before referenced offers and consumers when the bundle is full', () => {
    const post = request('migrations', 'emails');
    const result = selectCollaborationContext({
      focus: context('emails', 'Send shipment messages', {
        reliance: [reliance('estimates')],
        history: [{ kind: 'thread.posted', event_id: post.event_id, post }],
      }),
      candidates: [
        { context: context('migrations', 'Database compatibility') },
        { context: context('estimates', 'Send shipment messages') },
        {
          context: context('templates', 'Send shipment messages', {
            reliance: [reliance('emails')],
          }),
        },
      ],
      limit: 1,
    });
    expect(result.related.map((entry) => entry.bean)).toEqual(['migrations']);
    expect(result.required_omitted).toEqual(['estimates', 'templates']);
  });

  it('retains consumers of its promises even when their intent is unrelated', () => {
    const result = selectCollaborationContext({
      focus: context('estimates', 'Calculate delivery dates'),
      candidates: [
        { context: context('emails', 'Render templates', { reliance: [reliance('estimates')] }) },
      ],
    });
    expect(result.related[0]?.reasons).toEqual(['promise-consumer']);
    expect(result.related[0]?.promise_references[0]?.revision).toBe(1);
  });

  it('finds promised and observed paths independently of approach wording', () => {
    const promise = BeanPromise.parse({
      id: 'delivery-estimate',
      bean: 'estimates',
      revision: 2,
      body: 'Preserve days and expose calendarDays and businessDays',
      conditions: '',
      paths: ['src/shipping.ts'],
      actor: 'local-claude',
      offered_at: NOW,
      source: { bean: 'estimates', revision: 4, event_id: 9 },
    });
    const result = selectCollaborationContext({
      focus: context('emails', 'Display businessDays'),
      observed_paths: ['src/shipping.ts'],
      candidates: [{ context: context('estimates', 'Calculate dates', { promises: [promise] }) }],
    });
    expect(result.related[0]?.shared_paths).toEqual(['src/shipping.ts']);
    expect(result.related[0]?.reasons).toEqual(['shared-path', 'related-promise']);
    expect(result.related[0]?.revision).toBe(3);
    expect(result.related[0]?.current_cursor).toBe(11);
    expect(result.related[0]?.expand).toEqual({ bean: 'estimates' });
  });

  it('does not suggest unrelated beans merely because both describe making a code change', () => {
    const result = selectCollaborationContext({
      focus: context('emails', 'We should make a code change to send messages'),
      candidates: [
        { context: context('billing', 'We should make a code change to calculate taxes') },
      ],
    });
    expect(result.related).toEqual([]);
    expect(result.considered).toBe(1);
    expect(result.omitted).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('retains declared folder and file overlaps when the intents have no matching words', () => {
    const focusBase = context('emails', 'Render templates');
    const providerBase = context('estimates', 'Calculate dates');
    const focus = {
      ...focusBase,
      bean: {
        ...focusBase.bean,
        approach: { summary: 'Preserve compatibility', paths: ['src/shipping.ts'] },
      },
    };
    const provider = {
      ...providerBase,
      bean: {
        ...providerBase.bean,
        approach: { summary: 'Refactor calculation', paths: ['src'] },
      },
    };
    const folder = selectCollaborationContext({ focus, candidates: [{ context: provider }] });
    expect(folder.related[0]?.reasons).toEqual(['shared-path']);
    expect(folder.related[0]?.path_matches).toEqual([{ asked: 'src/shipping.ts', actual: 'src' }]);
    const file = selectCollaborationContext({ focus: provider, candidates: [{ context: focus }] });
    expect(file.related[0]?.path_matches).toEqual([{ asked: 'src', actual: 'src/shipping.ts' }]);
  });

  it('does not confuse similar folder prefixes with directory containment', () => {
    const result = selectCollaborationContext({
      focus: context('emails', 'Render templates'),
      observed_paths: ['src/shipping'],
      candidates: [
        { context: context('estimates', 'Calculate dates'), observed_paths: ['src/shipping-old'] },
      ],
    });
    expect(result.related).toEqual([]);
  });

  it('discloses required omissions and missing hydration without calling them irrelevant', () => {
    const result = selectCollaborationContext({
      focus: context('emails', '', {
        reliance: [reliance('a'), reliance('b'), reliance('unavailable')],
      }),
      candidates: [{ context: context('b') }, { context: context('a') }],
      limit: 1,
    });
    expect(result.related.map((entry) => entry.bean)).toEqual(['a']);
    expect(result.required_omitted).toEqual(['b']);
    expect(result.required_omitted_count).toBe(1);
    expect(result.missing_required).toEqual(['unavailable']);
    expect(result.missing_required_count).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it('follows exact promise references in notes and counters, not only recorded reliance', () => {
    const post = {
      ...request('emails', 'emails'),
      kind: 'note',
      references: [{ bean: 'estimates', promise: 'delivery-estimate', revision: 2 }],
    };
    const focus = context('emails', '', {
      history: [{ kind: 'thread.posted', event_id: 7, post: ThreadPost.parse(post) }],
    });
    const result = selectCollaborationContext({
      focus,
      candidates: [{ context: context('estimates') }],
    });
    expect(result.related[0]?.promise_references[0]?.revision).toBe(2);
    expect(result.related[0]?.reasons).toEqual(['promise-reference']);
  });

  it('reports incomplete history on either source without confusing the cursor with the revision', () => {
    const result = selectCollaborationContext({
      focus: context('emails', 'Shipping', { truncated: true }),
      candidates: [
        { context: context('estimates', 'Shipping', { current_cursor: 99, truncated: true }) },
      ],
    });
    expect(result.related[0]?.revision).toBe(3);
    expect(result.related[0]?.current_cursor).toBe(99);
    expect(result.related[0]?.context_truncated).toBe(true);
    expect(result.truncated).toBe(true);
  });

  it('deduplicates bean snapshots using the newest source cursor and ignores its own bean', () => {
    const older = context('estimates', 'Shipping', { current_cursor: 11 });
    const newer = context('estimates', 'Shipping calendar', { current_cursor: 12 });
    const focus = context('emails', 'Shipping');
    const result = selectCollaborationContext({
      focus,
      candidates: [{ context: older }, { context: focus }, { context: newer }],
    });
    expect(result.considered).toBe(1);
    expect(result.related[0]?.current_cursor).toBe(12);
    expect(result.related[0]?.intent.text).toBe('Shipping calendar');
  });

  it('bounds a thousand retrieved candidates and preserves Unicode excerpts', () => {
    const candidates = Array.from({ length: 1000 }, (_, index) => ({
      context: context(`candidate${index}`, `Shipping ${'🚚'.repeat(600)}`),
    }));
    const result = selectCollaborationContext({
      focus: context('emails', 'Shipping'),
      candidates,
      limit: 1000,
    });
    expect(result.considered).toBe(1000);
    expect(result.related).toHaveLength(20);
    expect(result.omitted).toBe(980);
    expect(result.related[0]?.intent.text.length).toBeLessThanOrEqual(500);
    expect(result.related[0]?.intent.text.endsWith('🚚')).toBe(true);
    expect(result.related[0]?.intent.truncated).toBe(true);
  });

  it('bounds expansion handles and counts the remaining missing sources', () => {
    const result = selectCollaborationContext({
      focus: context('emails', '', {
        reliance: Array.from({ length: 40 }, (_, index) => reliance(`missing${index}`)),
      }),
      candidates: [],
    });
    expect(result.missing_required).toHaveLength(32);
    expect(result.missing_required_count).toBe(40);
    expect(result.expansion_truncated).toBe(true);
  });

  it('ranks an excerpt-only peer and keeps the gateway cut marked as truncated', () => {
    const focus = context('emails', 'shipping estimates');
    const peer: PeerContext = {
      bean: {
        bean: TaskId.parse('shipping'),
        revision: 1,
        intent: 'shipping estimates',
        approach: null,
      },
      promises: [],
      reliance: [],
      current_cursor: 11,
      truncated: false,
      cut: { intent: true, approach: false },
    };
    const selection = selectCollaborationContext({ focus, candidates: [{ context: peer }] });
    expect(selection.related[0]?.intent).toEqual({ text: 'shipping estimates', truncated: true });
  });
});
