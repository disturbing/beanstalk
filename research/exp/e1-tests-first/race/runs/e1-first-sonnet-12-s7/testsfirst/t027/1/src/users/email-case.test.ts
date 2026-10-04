import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp } from '../lib/testing.ts';
import { findByEmail, registerUser } from './service.ts';

const body = { name: 'Ada', password: 'correct horse' };

describe('email case-insensitivity', () => {
  it('stores the email lower-cased', () => {
    const app = createTestApp();
    const res = app.call('POST', '/users', { body: { ...body, email: '  Ada@Example.com ' } });
    assert.equal(res.status, 201);
    assert.equal((res.body as { email: string }).email, 'ada@example.com');
  });

  it('rejects a registration that differs only in capitalisation with 409', () => {
    const app = createTestApp();
    assert.equal(app.call('POST', '/users', { body: { ...body, email: 'Ada@Example.com' } }).status, 201);
    assert.equal(app.call('POST', '/users', { body: { ...body, email: 'ada@example.com' } }).status, 409);
    assert.equal(app.call('POST', '/users', { body: { ...body, email: ' ADA@EXAMPLE.COM ' } }).status, 409);
    assert.equal(app.call('POST', '/users', { body: { ...body, email: 'grace@example.com' } }).status, 201);
    assert.equal(app.call('POST', '/users', { body: { ...body, email: 'Grace@example.com' } }).status, 409);
  });

  it('logs in regardless of the capitalisation typed', () => {
    const app = createTestApp();
    app.call('POST', '/users', { body: { ...body, email: 'Ada@Example.com' } });
    for (const email of ['ada@example.com', 'ADA@EXAMPLE.COM', ' Ada@Example.com ']) {
      const res = app.call('POST', '/auth/login', { body: { email, password: body.password } });
      assert.equal(res.status, 200, email);
    }
  });

  it('findByEmail ignores case and surrounding whitespace', () => {
    const app = createTestApp();
    const user = registerUser(app.ctx, { ...body, email: 'Ada@Example.com' });
    assert.equal(findByEmail(app.ctx, 'ADA@example.COM')?.id, user.id);
    assert.equal(findByEmail(app.ctx, '  ada@example.com  ')?.id, user.id);
    assert.equal(findByEmail(app.ctx, 'other@example.com'), undefined);
  });
});
