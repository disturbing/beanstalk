export class Repo<T> {
  rows = new Map<string, T>();

  put(key: string, value: T): void {
    this.rows.set(key, value);
  }

  get(key: string): T {
    if (!this.rows.has(key)) throw new Error(`no row ${key}`);
    return this.rows.get(key) as T;
  }

  all(): T[] {
    return [...this.rows.keys()].sort().map((k) => this.rows.get(k) as T);
  }
}
