import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp } from '../lib/testing.ts';
import { findByEmail } from './service.ts';

const base = { name: 'Ada', password: 'correct horse' };

describe('email case-insensitivity', () => {
  it('stores the email lower-cased', () => {
    const app = createTestApp();
    const res = app.call('POST', '/users', { body: { ...base, email: '  Ada@Example.COM ' } });
    assert.equal(res.status, 201);
    assert.equal((res.body as { email: string }).email, 'ada@example.com');
  });

  it('rejects registering an address that exists in another capitalisation', () => {
    const app = createTestApp();
    assert.equal(app.call('POST', '/users', { body: { ...base, email: 'Ada@Example.com' } }).status, 201);
    assert.equal(app.call('POST', '/users', { body: { ...base, email: 'ada@example.com' } }).status, 409);
    assert.equal(app.call('POST', '/users', { body: { ...base, email: ' ADA@EXAMPLE.COM ' } }).status, 409);
  });

  it('lets a customer log in with any capitalisation', () => {
    const app = createTestApp();
    app.call('POST', '/users', { body: { ...base, email: 'Ada@Example.com' } });
    for (const email of ['ada@example.com', 'ADA@EXAMPLE.COM', ' Ada@Example.com ']) {
      const res = app.call('POST', '/auth/login', { body: { email, password: base.password } });
      assert.equal(res.status, 200, email);
    }
  });

  it('finds a user by email regardless of case', () => {
    const app = createTestApp();
    const res = app.call('POST', '/users', { body: { ...base, email: 'Ada@Example.com' } });
    const id = (res.body as { id: string }).id;
    assert.equal(findByEmail(app.ctx, 'ADA@example.com')?.id, id);
    assert.equal(findByEmail(app.ctx, ' ada@example.com ')?.id, id);
  });
});
