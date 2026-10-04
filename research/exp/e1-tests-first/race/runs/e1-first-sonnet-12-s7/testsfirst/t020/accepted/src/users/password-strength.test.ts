import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, errorMessage } from '../lib/testing.ts';

const email = 'ada@example.com';
const base = { email, name: 'Ada', password: 'correct horse' };

describe('password strength at registration', () => {
  it('rejects a password shorter than 8 characters with a 400 and creates no account', () => {
    const app = createTestApp();
    for (const password of ['x', '1234567']) {
      const res = app.call('POST', '/users', { body: { ...base, password } });
      assert.equal(res.status, 400);
      assert.equal(errorMessage(res), 'password must be at least 8 characters');
    }
    assert.equal(app.ctx.store.users.findOne((u) => u.email === email), undefined);
  });

  it('accepts a password of exactly 8 characters', () => {
    const app = createTestApp();
    const res = app.call('POST', '/users', { body: { ...base, password: '12345678' } });
    assert.equal(res.status, 201);
  });

  it('rejects a password equal to the email address, ignoring case, and creates no account', () => {
    const app = createTestApp();
    for (const password of [email, 'ADA@Example.com']) {
      const res = app.call('POST', '/users', { body: { ...base, password } });
      assert.equal(res.status, 400);
      assert.equal(errorMessage(res), 'password must not be your email address');
    }
    assert.equal(app.ctx.store.users.findOne((u) => u.email === email), undefined);
  });

  it('still accepts a password that merely contains the email address', () => {
    const app = createTestApp();
    const res = app.call('POST', '/users', { body: { ...base, password: `${email}!` } });
    assert.equal(res.status, 201);
  });
});
