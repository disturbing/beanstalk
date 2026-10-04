import type { Migration } from '../migrate.ts';

export const migration0002: Migration = {
  version: 2,
  name: 'seed_coupons',
  up(store) {
    store.coupons.insert({
      id: 'WELCOME10',
      kind: 'percent',
      value: 10,
      minSubtotal: 0,
      expiresAt: null,
      maxRedemptions: null,
      redemptions: 0,
    });
    store.coupons.insert({
      id: 'FIVEOFF',
      kind: 'fixed',
      value: 500,
      minSubtotal: 2000,
      expiresAt: null,
      maxRedemptions: null,
      redemptions: 0,
    });
  },
};
