import type { Migration } from '../migrate.ts';

export const migration0004: Migration = {
  version: 4,
  name: 'order_shipping',
  up(store) {
    store.orders.addColumn('shippingCost', 0);
    store.orders.addColumn('trackingNumber', null);
  },
};
