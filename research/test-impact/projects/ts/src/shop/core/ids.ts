import { createHash } from "node:crypto";

export function shortId(prefix: string, ...parts: unknown[]): string {
  const digest = createHash("sha1").update(parts.map(String).join("|")).digest("hex");
  return `${prefix}-${digest.slice(0, 8)}`;
}

export class Sequence {
  prefix: string;
  next: number;

  constructor(prefix: string, start = 1) {
    this.prefix = prefix;
    this.next = start;
  }

  take(): string {
    const value = `${this.prefix}${String(this.next).padStart(5, "0")}`;
    this.next += 1;
    return value;
  }
}
