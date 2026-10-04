import type { Migration } from '../migrate.ts';

const TABLES = [
  'users',
  'sessions',
  'products',
  'carts',
  'orders',
  'invoices',
  'coupons',
  'stock',
  'shipments',
  'notifications',
];

export const migration0001: Migration = {
  version: 1,
  name: 'create_tables',
  up(store) {
    for (const name of TABLES) store.createTable(name);
  },
};
