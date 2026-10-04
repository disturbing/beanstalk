import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp } from '../lib/testing.ts';
import * as sessions from './sessions.ts';

describe('sessionExpiry', () => {
  it('defaults to one session lifetime after the context clock now', () => {
    const { ctx } = createTestApp();
    const expected = new Date(ctx.clock.now().getTime() + ctx.config.sessionTtlSeconds * 1000).toISOString();
    assert.equal(sessions.sessionExpiry(ctx), expected);
  });

  it('follows the clock as it advances', () => {
    const app = createTestApp();
    app.clock.advance(3600 * 1000);
    const { ctx } = app;
    const expected = new Date(ctx.clock.now().getTime() + ctx.config.sessionTtlSeconds * 1000).toISOString();
    assert.equal(sessions.sessionExpiry(ctx), expected);
  });

  it('measures from an explicit date', () => {
    const { ctx } = createTestApp();
    const from = new Date('2031-05-06T07:08:09.000Z');
    const expected = new Date(from.getTime() + ctx.config.sessionTtlSeconds * 1000).toISOString();
    assert.equal(sessions.sessionExpiry(ctx, from), expected);
  });

  it('matches the expiry createSession stores', () => {
    const { ctx } = createTestApp();
    const session = sessions.createSession(ctx, 'user-1');
    assert.equal(session.expiresAt, sessions.sessionExpiry(ctx));
  });
});
