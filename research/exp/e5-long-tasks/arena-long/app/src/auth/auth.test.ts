import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, signUp } from '../lib/testing.ts';
import { hashPassword, verifyPassword } from './password.ts';
import { createSession, findSession, purgeExpiredSessions } from './sessions.ts';

describe('passwords', () => {
  it('verifies the right password and rejects others', () => {
    const { hash, salt } = hashPassword('s3cret', 16);
    assert.ok(verifyPassword('s3cret', hash, salt, 16));
    assert.ok(!verifyPassword('S3cret', hash, salt, 16));
    assert.notEqual(hashPassword('s3cret', 16).hash, hash, 'salts differ per call');
  });
});

describe('login', () => {
  function register() {
    const app = createTestApp();
    app.call('POST', '/users', { body: { email: 'ada@example.com', name: 'Ada', password: 'correct horse' } });
    return app;
  }

  it('issues a token that opens authenticated routes', () => {
    const app = register();
    const res = app.call('POST', '/auth/login', { body: { email: 'ada@example.com', password: 'correct horse' } });
    assert.equal(res.status, 200);
    const { token } = res.body as { token: string };
    assert.equal(app.call('GET', '/users/me', { token }).status, 200);
  });

  it('rejects a wrong password and an unknown email the same way', () => {
    const app = register();
    const wrong = app.call('POST', '/auth/login', { body: { email: 'ada@example.com', password: 'nope' } });
    const unknown = app.call('POST', '/auth/login', { body: { email: 'bob@example.com', password: 'nope' } });
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, unknown.body);
  });
});

describe('sessions', () => {
  it('expire after the configured TTL', () => {
    const app = createTestApp();
    const { user } = signUp(app.ctx);
    const session = createSession(app.ctx, user.id);
    assert.ok(findSession(app.ctx, session.id));
    app.clock.advance(app.ctx.config.sessionTtlSeconds * 1000 + 1);
    assert.equal(findSession(app.ctx, session.id), undefined);
    assert.equal(app.call('GET', '/users/me', { token: session.id }).status, 401);
  });

  it('are destroyed on logout, which also purges expired ones', () => {
    const app = createTestApp();
    const { user, token } = signUp(app.ctx);
    const stale = createSession(app.ctx, user.id);
    app.clock.advance(app.ctx.config.sessionTtlSeconds * 1000 - 1000);
    const fresh = signUp(app.ctx, 'other@example.com');
    app.clock.advance(2000);
    assert.equal(app.call('POST', '/auth/logout', { token: fresh.token }).status, 204);
    assert.equal(app.call('GET', '/users/me', { token: fresh.token }).status, 401);
    assert.equal(app.ctx.store.sessions.get(stale.id), undefined);
    assert.equal(app.ctx.store.sessions.get(token), undefined);
    assert.equal(purgeExpiredSessions(app.ctx), 0);
  });

});
