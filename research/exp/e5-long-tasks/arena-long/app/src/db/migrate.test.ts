import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { openDatabase, runMigrations } from './migrate.ts';
import type { Migration } from './migrate.ts';
import { migrations } from './migrations/index.ts';
import { Store } from './store.ts';

describe('migrations', () => {
  it('registers every migration with a unique, increasing version', () => {
    const versions = migrations.map((m) => m.version);
    assert.deepEqual(versions, [...versions].sort((a, b) => a - b));
    assert.equal(new Set(versions).size, versions.length);
  });

  it('opens a database with tables and seed data', () => {
    const store = openDatabase();
    assert.equal(store.schemaVersion, migrations.at(-1)?.version);
    assert.ok(store.coupons.get('WELCOME10'));
    assert.deepEqual(runMigrations(store), []);
  });

  it('refuses duplicate versions', () => {
    const noop = (version: number): Migration => ({ version, name: `m${version}`, up() {} });
    assert.throws(() => runMigrations(new Store(), [noop(1), noop(1)]), /duplicate migration version 1/);
  });
});
