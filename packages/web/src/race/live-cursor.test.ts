import { describe, expect, it } from 'vitest';

import { resumeCursor } from './live-cursor';

function request(query: string, lastEventId?: string): Request {
  return new Request(`https://beanstalk.test/api/runs/abc123/live${query}`, {
    headers: lastEventId === undefined ? {} : { 'last-event-id': lastEventId },
  });
}

describe('resumeCursor', () => {
  it('resumes from the page-load seq on a first connect', () => {
    expect(resumeCursor(request('?after=40'))).toBe(40);
  });

  it('prefers Last-Event-ID over the page-load seq on a reconnect', () => {
    expect(resumeCursor(request('?after=40', '97'))).toBe(97);
  });

  it('starts at zero without either', () => {
    expect(resumeCursor(request(''))).toBe(0);
  });

  it('ignores a malformed or negative cursor', () => {
    expect(resumeCursor(request('?after=-3'))).toBe(0);
    expect(resumeCursor(request('?after=40', 'nope'))).toBe(0);
  });
});
