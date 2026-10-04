import { conflict, notFound } from '../lib/errors.ts';
import type {
  Cart,
  Coupon,
  Invoice,
  Notification,
  Order,
  Product,
  Session,
  Shipment,
  StockLevel,
  User,
} from '../types.ts';

type Row = { id: string };

/** One in-memory table. Column defaults are filled in on insert, like a SQL DEFAULT. */
export class Table<T extends Row> {
  readonly name: string;
  defaults: Record<string, unknown> = {};
  private rows = new Map<string, T>();

  constructor(name: string) {
    this.name = name;
  }

  insert(row: T): T {
    if (this.rows.has(row.id)) throw conflict(`${this.name} ${row.id} already exists`);
    const values = structuredClone(row) as Record<string, unknown>;
    for (const [column, value] of Object.entries(this.defaults)) {
      if (!(column in values)) values[column] = structuredClone(value);
    }
    const stored = values as T;
    this.rows.set(stored.id, stored);
    return structuredClone(stored);
  }

  get(id: string): T | undefined {
    const row = this.rows.get(id);
    return row ? structuredClone(row) : undefined;
  }

  require(id: string): T {
    const row = this.get(id);
    if (!row) throw notFound(this.name.replace(/s$/, ''));
    return row;
  }

  update(id: string, patch: Partial<T>): T {
    const current = this.rows.get(id);
    if (!current) throw notFound(this.name.replace(/s$/, ''));
    const next = structuredClone({ ...current, ...patch, id }) as T;
    this.rows.set(id, next);
    return structuredClone(next);
  }

  delete(id: string): boolean {
    return this.rows.delete(id);
  }

  all(): T[] {
    return [...this.rows.values()].map((row) => structuredClone(row));
  }

  find(predicate: (row: T) => boolean): T[] {
    return this.all().filter(predicate);
  }

  findOne(predicate: (row: T) => boolean): T | undefined {
    return this.all().find(predicate);
  }

  /** Used by migrations to backfill a new column on rows that already exist. */
  addColumn(column: string, value: unknown): void {
    this.defaults[column] = value;
    for (const [id, row] of this.rows) {
      if (!(column in row)) this.rows.set(id, { ...row, [column]: structuredClone(value) });
    }
  }

  /** Used by migrations to remove a column, including its default. */
  dropColumn(column: string): void {
    delete this.defaults[column];
    for (const [id, row] of this.rows) {
      const { [column]: _dropped, ...rest } = row as Record<string, unknown>;
      this.rows.set(id, rest as T);
    }
  }
}

export class Store {
  schemaVersion = 0;
  private tables = new Map<string, Table<Row>>();
  private counters = new Map<string, number>();

  createTable(name: string): void {
    if (this.tables.has(name)) throw new Error(`table ${name} already exists`);
    this.tables.set(name, new Table<Row>(name));
  }

  table<T extends Row>(name: string): Table<T> {
    const table = this.tables.get(name);
    if (!table) throw new Error(`no such table: ${name}`);
    return table as unknown as Table<T>;
  }

  /** Sequential ids per prefix: `ord_0001`, `ord_0002`, ... */
  nextId(prefix: string): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}_${String(next).padStart(4, '0')}`;
  }

  get users() { return this.table<User>('users'); }
  get sessions() { return this.table<Session>('sessions'); }
  get products() { return this.table<Product>('products'); }
  get carts() { return this.table<Cart>('carts'); }
  get orders() { return this.table<Order>('orders'); }
  get invoices() { return this.table<Invoice>('invoices'); }
  get coupons() { return this.table<Coupon>('coupons'); }
  get stock() { return this.table<StockLevel>('stock'); }
  get shipments() { return this.table<Shipment>('shipments'); }
  get notifications() { return this.table<Notification>('notifications'); }
}
