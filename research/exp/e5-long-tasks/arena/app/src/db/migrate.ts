import { migrations as registry } from './migrations/index.ts';
import { Store } from './store.ts';

export interface Migration {
  /** Strictly increasing; matches the numeric prefix of the file name. */
  version: number;
  name: string;
  up(store: Store): void;
}

/** Apply every pending migration in version order. Returns the versions that ran. */
export function runMigrations(store: Store, migrations: Migration[] = registry): number[] {
  const seen = new Set<number>();
  for (const migration of migrations) {
    if (seen.has(migration.version)) {
      throw new Error(`duplicate migration version ${migration.version} (${migration.name})`);
    }
    seen.add(migration.version);
  }
  const pending = migrations
    .filter((m) => m.version > store.schemaVersion)
    .sort((a, b) => a.version - b.version);
  for (const migration of pending) {
    migration.up(store);
    store.schemaVersion = migration.version;
  }
  return pending.map((m) => m.version);
}

/** A fresh, fully migrated database. */
export function openDatabase(): Store {
  const store = new Store();
  runMigrations(store);
  return store;
}
