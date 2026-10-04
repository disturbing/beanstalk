import type { Migration } from '../migrate.ts';
import { migration0001 } from './0001_create_tables.ts';
import { migration0002 } from './0002_seed_coupons.ts';
import { migration0003 } from './0003_product_weight.ts';
import { migration0004 } from './0004_order_shipping.ts';
import { migration0005 } from './0005_user_roles.ts';

/** Every migration, in order. Add new ones at the end. */
export const migrations: Migration[] = [
  migration0001,
  migration0002,
  migration0003,
  migration0004,
  migration0005,
];
