import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AppError } from '../lib/errors.ts';
import { Store, Table } from './store.ts';

type Thing = { id: string; label: string; size?: number };

describe('Table', () => {

  it('rejects duplicate ids with a 409', () => {
    const table = new Table<Thing>('things');
    table.insert({ id: 'a', label: 'x' });
    assert.throws(() => table.insert({ id: 'a', label: 'y' }), (e) => e instanceof AppError && e.status === 409);
  });

  it('backfills new columns and applies them as defaults', () => {
    const table = new Table<Thing>('things');
    table.insert({ id: 'a', label: 'x' });
    table.addColumn('size', 7);
    table.insert({ id: 'b', label: 'y' });
    assert.equal(table.get('a')?.size, 7);
    assert.equal(table.get('b')?.size, 7);
  });
});

describe('Table columns', () => {
  it('drops a column and its default', () => {
    const table = new Table<Thing>('things');
    table.addColumn('size', 7);
    table.insert({ id: 'a', label: 'x' });
    table.dropColumn('size');
    table.insert({ id: 'b', label: 'y' });
    assert.deepEqual(table.get('a'), { id: 'a', label: 'x' });
    assert.deepEqual(table.get('b'), { id: 'b', label: 'y' });
  });
});

describe('Store', () => {
  it('hands out sequential ids per prefix', () => {
    const store = new Store();
    assert.deepEqual([store.nextId('ord'), store.nextId('ord'), store.nextId('inv')], ['ord_0001', 'ord_0002', 'inv_0001']);
  });
});
