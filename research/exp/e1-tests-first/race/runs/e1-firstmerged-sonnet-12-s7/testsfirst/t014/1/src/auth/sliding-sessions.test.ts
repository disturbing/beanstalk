import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, signUp } from '../lib/testing.ts';

describe('sliding session expiry', () => {
  it('keeps an active customer logged in past the original expiry', () => {
    const app = createTestApp();
    const ttl = app.ctx.config.sessionTtlSeconds * 1000;
    const { token } = signUp(app.ctx);
    for (let i = 0; i < 4; i++) {
      app.clock.advance(ttl * 0.6);
      assert.equal(app.call('GET', '/users/me', { token }).status, 200);
    }
  });

  it('moves expiresAt to a full lifetime from now on each authenticated request', () => {
    const app = createTestApp();
    const ttl = app.ctx.config.sessionTtlSeconds * 1000;
    const { token } = signUp(app.ctx);
    app.clock.advance(ttl / 2);
    assert.equal(app.call('GET', '/users/me', { token }).status, 200);
    const expected = new Date(app.clock.now().getTime() + ttl).toISOString();
    assert.equal(app.ctx.store.sessions.get(token)?.expiresAt, expected);
  });

  it('expires a full lifetime after the last request', () => {
    const app = createTestApp();
    const ttl = app.ctx.config.sessionTtlSeconds * 1000;
    const { token } = signUp(app.ctx);
    app.clock.advance(ttl - 1000);
    assert.equal(app.call('GET', '/users/me', { token }).status, 200);
    app.clock.advance(ttl - 500);
    assert.equal(app.call('GET', '/users/me', { token }).status, 200);
    app.clock.advance(ttl + 1);
    assert.equal(app.call('GET', '/users/me', { token }).status, 401);
  });

  it('does not revive a session that has already expired', () => {
    const app = createTestApp();
    const ttl = app.ctx.config.sessionTtlSeconds * 1000;
    const { token } = signUp(app.ctx);
    app.clock.advance(ttl + 1);
    assert.equal(app.call('GET', '/users/me', { token }).status, 401);
    app.clock.advance(1000);
    assert.equal(app.call('GET', '/users/me', { token }).status, 401);
  });

  it('does not extend the session on unauthenticated or invalid-token requests', () => {
    const app = createTestApp();
    const ttl = app.ctx.config.sessionTtlSeconds * 1000;
    const { token } = signUp(app.ctx);
    const before = app.ctx.store.sessions.get(token)?.expiresAt;
    app.clock.advance(ttl / 2);
    app.call('GET', '/users/me', { token: 'bogus' });
    app.call('GET', '/users/me');
    assert.equal(app.ctx.store.sessions.get(token)?.expiresAt, before);
  });
});
