import type { Migration } from '../migrate.ts';

export const migration0005: Migration = {
  version: 5,
  name: 'user_roles',
  up(store) {
    store.users.addColumn('role', 'customer');
  },
};
