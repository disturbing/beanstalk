import type { Migration } from '../migrate.ts';

export const migration0003: Migration = {
  version: 3,
  name: 'product_weight',
  up(store) {
    store.products.addColumn('weightKg', 0.5);
  },
};
