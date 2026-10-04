import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp } from '../lib/testing.ts';
import * as sessions from './sessions.ts';

const { createSession, findSession } = sessions;

function sessionExpiry(...args: unknown[]): string {
  const fn = (sessions as Record<string, unknown>).sessionExpiry;
  assert.equal(typeof fn, 'function', 'sessionExpiry is exported');
  return (fn as (...a: unknown[]) => string)(...args);
}

describe('sessionExpiry', () => {
  it('defaults to one session lifetime after the context clock now', () => {
    const app = createTestApp();
    const ttl = app.ctx.config.sessionTtlSeconds;
    const expected = new Date(app.clock.now().getTime() + ttl * 1000).toISOString();
    assert.equal(sessionExpiry(app.ctx), expected);
  });

  it('follows the clock as it advances', () => {
    const app = createTestApp();
    app.clock.advance(3_600_000);
    const ttl = app.ctx.config.sessionTtlSeconds;
    assert.equal(sessionExpiry(app.ctx), new Date(app.clock.now().getTime() + ttl * 1000).toISOString());
  });

  it('measures from an explicit date', () => {
    const app = createTestApp();
    const from = new Date('2030-01-01T00:00:00.000Z');
    const ttl = app.ctx.config.sessionTtlSeconds;
    assert.equal(sessionExpiry(app.ctx, from), new Date(from.getTime() + ttl * 1000).toISOString());
  });

  it('uses the configured lifetime', () => {
    const app = createTestApp();
    app.ctx.config.sessionTtlSeconds = 90;
    const from = new Date('2030-01-01T00:00:00.000Z');
    assert.equal(sessionExpiry(app.ctx, from), '2030-01-01T00:01:30.000Z');
  });
});

describe('createSession expiry', () => {
  it('expires at sessionExpiry of the creation time', () => {
    const app = createTestApp();
    app.ctx.config.sessionTtlSeconds = 90;
    const session = createSession(app.ctx, 'u1');
    assert.equal(session.createdAt, app.clock.now().toISOString());
    assert.equal(session.expiresAt, sessionExpiry(app.ctx, app.clock.now()));
    assert.equal(session.expiresAt, new Date(app.clock.now().getTime() + 90_000).toISOString());
    assert.ok(findSession(app.ctx, session.id));
    app.clock.advance(90_000);
    assert.equal(findSession(app.ctx, session.id), undefined);
  });
});
