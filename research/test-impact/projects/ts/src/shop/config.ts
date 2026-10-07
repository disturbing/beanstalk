import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG } from "./paths.ts";

export type AppConfig = Record<string, unknown>;

let cached: AppConfig | undefined;

export function load(): AppConfig {
  cached ??= JSON.parse(readFileSync(join(CONFIG, "app.json"), "utf8")) as AppConfig;
  return cached;
}

export function get<T>(key: string, fallback?: T): T {
  const cfg = load();
  return (key in cfg ? cfg[key] : fallback) as T;
}
