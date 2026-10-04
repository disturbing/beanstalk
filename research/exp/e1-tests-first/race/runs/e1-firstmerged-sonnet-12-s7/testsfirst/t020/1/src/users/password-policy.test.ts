import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, errorMessage } from '../lib/testing.ts';

const base = { email: 'ada@example.com', name: 'Ada' };
const SHORT = 'password must be at least 8 characters';
const SAME = 'password must not be your email address';

describe('password policy at registration', () => {
  it('rejects a one-character password with 400', () => {
    const app = createTestApp();
    const res = app.call('POST', '/users', { body: { ...base, password: 'x' } });
    assert.equal(res.status, 400);
    assert.equal(errorMessage(res), SHORT);
  });

  it('rejects a 7-character password but accepts exactly 8', () => {
    const app = createTestApp();
    const short = app.call('POST', '/users', { body: { ...base, password: '1234567' } });
    assert.equal(short.status, 400);
    assert.equal(errorMessage(short), SHORT);
    const ok = app.call('POST', '/users', { body: { ...base, password: '12345678' } });
    assert.equal(ok.status, 201);
  });

  it('rejects a password equal to the email, ignoring case', () => {
    const app = createTestApp();
    for (const password of ['ada@example.com', 'ADA@Example.COM']) {
      const res = app.call('POST', '/users', { body: { ...base, password } });
      assert.equal(res.status, 400);
      assert.equal(errorMessage(res), SAME);
    }
  });

  it('accepts a password that merely contains the email', () => {
    const app = createTestApp();
    const res = app.call('POST', '/users', { body: { ...base, password: 'ada@example.com!' } });
    assert.equal(res.status, 201);
  });

  it('does not create an account when the password is rejected', () => {
    const app = createTestApp();
    assert.equal(app.call('POST', '/users', { body: { ...base, password: 'x' } }).status, 400);
    assert.equal(app.call('POST', '/users', { body: { ...base, password: 'ada@example.com' } }).status, 400);
    // The email is still free, so a valid registration succeeds rather than 409.
    assert.equal(app.call('POST', '/users', { body: { ...base, password: 'long enough' } }).status, 201);
  });
});
