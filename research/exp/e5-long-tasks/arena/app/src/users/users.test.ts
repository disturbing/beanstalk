import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createTestApp, signUp } from '../lib/testing.ts';

const body = { email: 'ada@example.com', name: 'Ada', password: 'correct horse' };

describe('users', () => {
  it('registers a customer without leaking credentials', () => {
    const app = createTestApp();
    const res = app.call('POST', '/users', { body });
    assert.equal(res.status, 201);
    const user = res.body as Record<string, unknown>;
    assert.equal(user.role, 'customer');
    assert.ok(!('passwordHash' in user) && !('passwordSalt' in user));
  });

  it('rejects duplicate and malformed registrations', () => {
    const app = createTestApp();
    app.call('POST', '/users', { body });
    assert.equal(app.call('POST', '/users', { body }).status, 409);
    assert.equal(app.call('POST', '/users', { body: { ...body, email: 'not-an-email' } }).status, 400);
    assert.equal(app.call('POST', '/users', { body: { email: 'x@example.com', name: 'X' } }).status, 400);
  });

  it('updates the profile name but not to an empty one', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx);
    const res = app.call('PATCH', '/users/me', { token, body: { name: 'Ada L.' } });
    assert.equal((res.body as { name: string }).name, 'Ada L.');
    assert.equal(app.call('PATCH', '/users/me', { token, body: { name: '  ' } }).status, 400);
  });

  it('appends addresses and upper-cases the country', () => {
    const app = createTestApp();
    const { token } = signUp(app.ctx, 'ada@example.com', { address: null });
    const address = { line1: '1 Main St', city: 'Leeds', region: 'WYK', postalCode: 'LS1 4AP', country: 'gb' };
    const res = app.call('POST', '/users/me/addresses', { token, body: address });
    assert.equal(res.status, 201);
    assert.equal((res.body as { addresses: { country: string }[] }).addresses[0].country, 'GB');
  });

});
