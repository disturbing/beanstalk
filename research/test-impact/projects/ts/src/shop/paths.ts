import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Project root: two levels up from src/shop/. */
export const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const DATA = join(ROOT, "data");
export const CONFIG = join(ROOT, "config");
