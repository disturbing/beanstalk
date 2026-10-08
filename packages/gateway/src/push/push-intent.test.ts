import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WAIT_SECONDS,
  MAX_WAIT_SECONDS,
  parsePushOptions,
  pushIntent,
} from './push-intent';

describe('push intent', () => {
  it('takes the title from the subject, the intent from the message and the task from its trailer', () => {
    const intent = pushIntent(
      'Add a total helper\n\nSums the line items.\n\nTask: T-12\nSigned-off-by: a <a@b>',
      parsePushOptions([]),
    );
    expect(intent).toEqual({
      title: 'Add a total helper',
      intent: 'Add a total helper\n\nSums the line items.',
      task: 'T-12',
    });
  });

  it('lets push options override the intent and the task', () => {
    const options = parsePushOptions(['intent=Make totals exact', 'task=T-9', 'wait']);
    expect(pushIntent('wip', options)).toEqual({
      title: 'Make totals exact',
      intent: 'Make totals exact',
      task: 'T-9',
    });
  });

  it('reads wait with and without seconds, and reports unknown options', () => {
    expect(parsePushOptions(['wait']).waitSeconds).toBe(DEFAULT_WAIT_SECONDS);
    expect(parsePushOptions(['wait=30']).waitSeconds).toBe(30);
    expect(parsePushOptions(['wait=99999']).waitSeconds).toBe(MAX_WAIT_SECONDS);
    expect(parsePushOptions([]).waitSeconds).toBeNull();
    expect(parsePushOptions(['ci.skip']).unknown).toEqual(['ci.skip']);
  });

  it('reads the beans a wait names, repeated or comma-separated, without branch prefixes', () => {
    expect(parsePushOptions(['bean=a', 'bean=b,bean/c', 'bean=a']).beans).toEqual(['a', 'b', 'c']);
    expect(parsePushOptions(['bean=refs/heads/bean/d']).beans).toEqual(['d']);
    expect(parsePushOptions(['bean=']).unknown).toEqual(['bean=']);
  });

  it('names an untitled bean when the commit cannot be read', () => {
    expect(pushIntent('', parsePushOptions([]))).toEqual({
      title: 'untitled bean',
      intent: 'untitled bean',
      task: null,
    });
  });
});
