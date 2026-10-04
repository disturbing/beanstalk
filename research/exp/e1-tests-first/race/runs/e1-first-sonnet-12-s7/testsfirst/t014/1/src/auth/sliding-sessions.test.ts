import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, signUp } from '../lib/testing.ts';

describe('sliding sessions', () => {
  it('keeps an active customer logged in past the original expiry', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const ttl = app.ctx.config.sessionTtlSeconds * 1000;
    for (let i = 0; i < 4; i++) {
      app.clock.advance(ttl * 0.6);
      assert.equal(app.call('GET', '/users/me', { token }).status, 200, `request ${i}`);
    }
  });

  it('moves expiresAt out to a full lifetime from now on each authenticated request', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const ttl = app.ctx.config.sessionTtlSeconds * 1000;
    app.clock.advance(ttl / 2);
    assert.equal(app.call('GET', '/users/me', { token }).status, 200);
    const expiresAt = new Date(app.ctx.store.sessions.get(token)!.expiresAt).getTime();
    assert.equal(expiresAt, app.clock.now().getTime() + ttl);
  });

  it('still expires a full lifetime after the last request', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const ttl = app.ctx.config.sessionTtlSeconds * 1000;
    app.clock.advance(ttl / 2);
    app.call('GET', '/users/me', { token });
    app.clock.advance(ttl + 1);
    assert.equal(app.call('GET', '/users/me', { token }).status, 401);
  });

  it('does not revive a session that has already expired', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const ttl = app.ctx.config.sessionTtlSeconds * 1000;
    app.clock.advance(ttl + 1);
    assert.equal(app.call('GET', '/users/me', { token }).status, 401);
    app.clock.advance(1000);
    assert.equal(app.call('GET', '/users/me', { token }).status, 401);
  });

  it('does not extend a session for requests with a different token', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const before = app.ctx.store.sessions.get(token)!.expiresAt;
    app.clock.advance(1000);
    app.call('GET', '/users/me', { token: 'bogus' });
    assert.equal(app.ctx.store.sessions.get(token)!.expiresAt, before);
  });
});
