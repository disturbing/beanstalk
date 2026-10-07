import { readFileSync } from "node:fs";

/** Minimal csv.DictReader: header row + comma-separated rows, no quoting. */
export function readCsv(path: string): Record<string, string>[] {
  const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ""));
    return row;
  });
}
