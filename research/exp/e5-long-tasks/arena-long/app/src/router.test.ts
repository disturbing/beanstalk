import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { conflict } from './lib/errors.ts';
import { createTestApp, signUp } from './lib/testing.ts';
import { Router, ok } from './router.ts';

function setup() {
  const app = createTestApp();
  const router = new Router();
  router.add('GET', '/echo/:word', 'public', (req) => ok({ word: req.params.word, query: req.query }));
  router.add('GET', '/boom', 'public', () => { throw conflict('nope'); });
  router.add('GET', '/me', 'user', (req) => ok({ id: req.user?.id }));
  router.add('GET', '/admin', 'admin', () => ok('secret'));
  return { app, send: (input: Parameters<Router['handle']>[1]) => router.handle(app.ctx, input) };
}

describe('router', () => {
  it('extracts path params and parses the query string', () => {
    const { send } = setup();
    const res = send({ method: 'GET', path: '/echo/h%C3%A9llo?a=1&b=two' });
    assert.deepEqual(res.body, { word: 'héllo', query: { a: '1', b: 'two' } });
  });

  it('renders AppErrors as JSON error bodies', () => {
    const res = setup().send({ method: 'GET', path: '/boom' });
    assert.equal(res.status, 409);
    assert.deepEqual(res.body, { error: { code: 'conflict', message: 'nope' } });
  });

  it('requires a session for user routes', () => {
    const { app, send } = setup();
    assert.equal(send({ method: 'GET', path: '/me' }).status, 401);
    const { token, user } = signUp(app.ctx);
    const res = send({ method: 'GET', path: '/me', headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual(res.body, { id: user.id });
  });

  it('keeps admin routes away from customers', () => {
    const { app, send } = setup();
    const customer = signUp(app.ctx, 'c@example.com');
    const admin = signUp(app.ctx, 'a@example.com', { admin: true });
    const as = (token: string) => send({ method: 'GET', path: '/admin', headers: { authorization: `Bearer ${token}` } });
    assert.equal(as(customer.token).status, 403);
    assert.equal(as(admin.token).status, 200);
  });
});
