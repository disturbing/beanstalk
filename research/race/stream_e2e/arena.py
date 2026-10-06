"""A throwaway arena for the streaming-diffs loop: the 5-task fixture app with two of its tasks (t001, t003) and one
task that makes an agent write a few dozen lines over several edits (t101), so a stream has something to show,
one that touches every module (t102) and one that edits the middle of a long existing file (t103: the catalog,
about 155 lines), so the view must follow a hunk rather than the end of a file.

    python3 stream_e2e/arena.py      # writes stream_e2e/.local/arena/ (tasks/) and .local/arena.git (main + ref/*)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURE = os.path.join(HERE, "..", "tests", "fixtures", "arena")
ARENA = os.path.join(HERE, ".local", "arena")
REPO = os.path.join(HERE, ".local", "arena.git")

REPORT_TEST = """import { test } from "node:test";
import assert from "node:assert/strict";
import { summarize, formatReport } from "../../src/report/index.ts";

const orders = [
  { id: "o1", lines: [{ sku: "lamp", priceCents: 5000, qty: 2 }, { sku: "mug", priceCents: 1250, qty: 4 }] },
  { id: "o2", lines: [{ sku: "lamp", priceCents: 5000, qty: 1 }] },
  { id: "o3", lines: [{ sku: "rug", priceCents: 12000, qty: 1 }] },
];

test("summarize counts orders, revenue, the average order and the best-selling sku by revenue", () => {
  assert.deepEqual(summarize(orders), {
    orders: 3, revenueCents: 32000, averageCents: 10667, topSku: "lamp", units: 8,
  });
});

test("an empty week reports zeros and no top sku", () => {
  assert.deepEqual(summarize([]), { orders: 0, revenueCents: 0, averageCents: 0, topSku: null, units: 0 });
});

test("formatReport prints one labelled line per figure, money in dollars", () => {
  assert.equal(formatReport(summarize(orders)),
    "Orders: 3\\nUnits: 8\\nRevenue: $320.00\\nAverage order: $106.67\\nTop sku: lamp");
});
"""

T101 = {
    "id": "t101",
    "title": "Weekly sales report",
    "prompt": ("Finance wants a weekly sales report. Add a module src/report/index.ts that exports "
               "summarize(orders) and formatReport(summary). An order is { id, lines: [{ sku, priceCents, qty }] }. "
               "summarize returns { orders, units, revenueCents, averageCents (rounded to the nearest cent), topSku "
               "(the sku with the most revenue, null when there are no orders) }. formatReport prints one labelled "
               "line per figure (Orders, Units, Revenue, Average order, Top sku), money as dollars with two "
               "decimals. Write it in small, documented functions (a JSDoc comment on each), put the money "
               "formatting in its own helper, and add a line about the report to CHANGELOG.md."),
    "acceptance_tests": {"test/acceptance/t101.test.ts": REPORT_TEST},
    "oracle_paths": ["src/report/index.ts", "CHANGELOG.md"],
    "oracle_modules": ["src/report"],
    "kind": "feature",
    "difficulty": 2,
    "couplings": [],
}


GUARD_TEST = """import { test } from "node:test";
import assert from "node:assert/strict";
import { total } from "../../src/cart/index.ts";

test("cart totals refuse lines with a negative quantity or a fractional price", () => {
  assert.throws(() => total([{ sku: "mug", priceCents: 250, qty: -1 }]), TypeError);
  assert.throws(() => total([{ sku: "mug", priceCents: 2.5, qty: 1 }]), TypeError);
});
"""

T102 = {
    "id": "t102",
    "title": "Validate inputs across the shop modules",
    "prompt": ("Bad input reaches our modules silently. Go through every module under src/ (cart, invoice, money, "
               "users, routes) and make each exported function validate its arguments: throw a TypeError with a "
               "message naming the argument and what was expected (for example negative quantities, prices that are "
               "not whole cents, empty ids). Change one module at a time with small focused edits, add a short "
               "JSDoc line to each function you touch, and run the tests as you go. Add a CHANGELOG.md line."),
    "acceptance_tests": {"test/acceptance/t102.test.ts": GUARD_TEST},
    "oracle_paths": ["src/cart/index.ts", "src/invoice/index.ts", "src/money/index.ts", "src/users/index.ts",
                     "src/routes/index.ts", "CHANGELOG.md"],
    "oracle_modules": ["src/cart", "src/invoice", "src/money", "src/users", "src/routes"],
    "kind": "feature",
    "difficulty": 3,
    "couplings": [],
}


SKUS = ["lamp", "mug", "rug", "desk", "chair", "shelf", "vase", "clock", "frame", "pillow", "throw", "candle",
        "bowl", "plate", "kettle", "toaster", "mirror", "basket", "stool", "bench", "hook", "tray", "jar", "pan"]

CATALOG_HEAD = """/** The shop's product catalog: list prices, weights and discounts. */
export interface Product {
  sku: string;
  priceCents: number;
  weightGrams: number;
  discountPercent: number;
}

export const PRODUCTS: Product[] = [
%s
];

function find(sku: string): Product {
  const product = PRODUCTS.find((p) => p.sku === sku);
  if (product === undefined) throw new Error(`unknown sku ${sku}`);
  return product;
}

/** Every sku in the catalog, in catalog order. */
export function skus(): string[] {
  return PRODUCTS.map((p) => p.sku);
}

/** Whether the catalog sells this sku. */
export function has(sku: string): boolean {
  return PRODUCTS.some((p) => p.sku === sku);
}

/** The list price of a sku, in cents. */
export function priceOf(sku: string): number {
  return find(sku).priceCents;
}

/** The shipping weight of a sku, in grams. */
export function weightOf(sku: string): number {
  return find(sku).weightGrams;
}

/** The cheapest sku. */
export function cheapest(): string {
  return [...PRODUCTS].sort((a, b) => a.priceCents - b.priceCents)[0].sku;
}

/** The heaviest sku. */
export function heaviest(): string {
  return [...PRODUCTS].sort((a, b) => b.weightGrams - a.weightGrams)[0].sku;
}

/**
 * The discount on a sku, in percent of its list price, as merchandising set it.
 * Merchandising enters these by hand.
 */
export function discountFor(sku: string): number {
  return find(sku).discountPercent;
}

/** The price a customer pays for one unit of a sku, after its discount, in cents. */
export function salePrice(sku: string): number {
  const price = priceOf(sku);
  return Math.round(price - (price * discountFor(sku)) / 100);
}

/** Whether a sku is on sale at all. */
export function onSale(sku: string): boolean {
  return discountFor(sku) > 0;
}

/** What shipping a parcel costs, in cents: a flat 500. */
export function shippingCents(weightGrams: number): number {
  return 500;
}

/** The shipping weight of a list of skus, in grams. */
export function parcelWeight(items: string[]): number {
  return items.reduce((sum, sku) => sum + weightOf(sku), 0);
}

/** Skus sorted by list price, cheapest first. */
export function byPrice(): string[] {
  return [...PRODUCTS].sort((a, b) => a.priceCents - b.priceCents).map((p) => p.sku);
}

/** Skus sorted by weight, lightest first. */
export function byWeight(): string[] {
  return [...PRODUCTS].sort((a, b) => a.weightGrams - b.weightGrams).map((p) => p.sku);
}

/** The skus on sale. */
export function saleSkus(): string[] {
  return PRODUCTS.filter((p) => p.discountPercent > 0).map((p) => p.sku);
}

/** The average list price, in cents. */
export function averagePrice(): number {
  return Math.round(PRODUCTS.reduce((s, p) => s + p.priceCents, 0) / PRODUCTS.length);
}

/** The weight of one of everything, in grams. */
export function totalWeight(): number {
  return PRODUCTS.reduce((s, p) => s + p.weightGrams, 0);
}

/** A one-line description of a sku for the storefront. */
export function describe(sku: string): string {
  return `${sku}: $${(salePrice(sku) / 100).toFixed(2)}`;
}

/** Skus whose name contains the text. */
export function search(text: string): string[] {
  return skus().filter((s) => s.includes(text));
}

/** One page of skus, ten per page, the first page 0. */
export function pageOf(page: number): string[] {
  return skus().slice(page * 10, page * 10 + 10);
}

/** Skus that cost less than a budget, in cents. */
export function under(budgetCents: number): string[] {
  return PRODUCTS.filter((p) => p.priceCents < budgetCents).map((p) => p.sku);
}

/** Skus lighter than a weight, in grams. */
export function lighterThan(grams: number): string[] {
  return PRODUCTS.filter((p) => p.weightGrams < grams).map((p) => p.sku);
}

/** The catalog as CSV, one line per sku with a header. */
export function toCsv(): string {
  const lines = PRODUCTS.map((p) => `${p.sku},${p.priceCents},${p.weightGrams},${p.discountPercent}`);
  return ["sku,priceCents,weightGrams,discountPercent", ...lines].join("\\n");
}
"""


def catalog_module() -> str:
    """A long existing file (about 155 lines) for t103, whose two fixes sit in its middle."""
    rows = "\n".join(f'  {{ sku: "{sku}", priceCents: {1000 + i * 350}, weightGrams: {300 + i * 140}, '
                     f'discountPercent: {(i * 7) % 45} }},' for i, sku in enumerate(SKUS))
    return CATALOG_HEAD % rows


CATALOG_TEST = """import { test } from "node:test";
import assert from "node:assert/strict";
import { byCategory, discountFor, salePrice, shippingCents } from "../../src/catalog/index.ts";

test("products have categories", () => {
  assert.deepEqual(byCategory("lighting"), ["lamp", "candle"]);
  assert.equal(byCategory("kitchen").length, 8);
});

test("discounts are capped at 30 percent", () => {
  assert.equal(discountFor("vase"), 30);
  assert.equal(salePrice("vase"), 2170);
  assert.equal(discountFor("mug"), 7);
});

test("shipping is 500 cents up to a kilo, then 2 cents a gram over", () => {
  assert.equal(shippingCents(800), 500);
  assert.equal(shippingCents(1000), 500);
  assert.equal(shippingCents(1250), 1000);
});
"""

T103 = {
    "id": "t103",
    "title": "Catalog categories, capped discounts and shipping by weight",
    "prompt": ("Five changes to the product catalog, src/catalog/index.ts (a long file: change it in place with "
               "the Edit tool, one edit per step, in this order). 1. Give Product a `category` field and set it on "
               "every row of PRODUCTS: kitchen for mug, bowl, plate, kettle, toaster, jar, pan and tray; lighting "
               "for lamp and candle; home for everything else. 2. At the end of the file add byCategory(category), "
               "the skus of that category in catalog order, with a JSDoc line. 3. Merchandising typed some "
               "discounts above what we allow: discountFor(sku) must never return more than 30 (percent), "
               "whatever the table says; update its JSDoc to say so. 4. Shipping is no longer flat: "
               "shippingCents(weightGrams) is 500 cents up to and including 1000 grams, plus 2 cents for every "
               "gram over 1000; update its JSDoc too. 5. Last, rewrite the JSDoc on the first line of the file "
               "so it also mentions categories. Then add a line to CHANGELOG.md."),
    "acceptance_tests": {"test/acceptance/t103.test.ts": CATALOG_TEST},
    "oracle_paths": ["src/catalog/index.ts", "CHANGELOG.md"],
    "oracle_modules": ["src/catalog"],
    "kind": "feature",
    "difficulty": 2,
    "couplings": [],
}


def git(cwd: str, *args: str) -> None:
    env = dict(os.environ, GIT_AUTHOR_NAME="arena", GIT_AUTHOR_EMAIL="arena@beanstalk.invalid",
               GIT_COMMITTER_NAME="arena", GIT_COMMITTER_EMAIL="arena@beanstalk.invalid")
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, env=env)


def main() -> None:
    shutil.rmtree(ARENA, ignore_errors=True)
    os.makedirs(os.path.join(ARENA, "tasks"))
    os.makedirs(os.path.join(ARENA, "solutions"))
    tasks = [json.load(open(os.path.join(FIXTURE, "tasks", f"{t}.json"))) for t in ("t001", "t003")] + [T101, T102, T103]
    for t in tasks:
        with open(os.path.join(ARENA, "tasks", f"{t['id']}.json"), "w") as fh:
            json.dump(t, fh, indent=2)
    shutil.rmtree(REPO, ignore_errors=True)
    with tempfile.TemporaryDirectory() as tmp:
        work = os.path.join(tmp, "w")
        shutil.copytree(os.path.join(FIXTURE, "app"), work)
        os.makedirs(os.path.join(work, "src", "catalog"))
        with open(os.path.join(work, "src", "catalog", "index.ts"), "w") as fh:
            fh.write(catalog_module())
        git(work, "init", "-q", "-b", "main")
        git(work, "config", "commit.gpgsign", "false")
        git(work, "add", "-A")
        git(work, "commit", "-q", "-m", "Base shop service")
        for t in tasks:  # ref/<id>: the acceptance tests only (real agents need no reference solution)
            git(work, "checkout", "-q", "-b", f"ref/{t['id']}", "main")
            for path, content in t["acceptance_tests"].items():
                os.makedirs(os.path.dirname(os.path.join(work, path)), exist_ok=True)
                with open(os.path.join(work, path), "w") as fh:
                    fh.write(content)
            git(work, "add", "-A")
            git(work, "commit", "-q", "-m", t["title"])
        git(work, "checkout", "-q", "main")
        git(tmp, "clone", "-q", "--bare", work, REPO)
    print(f"arena: {ARENA}\nrepo: {REPO}")


if __name__ == "__main__":
    main()
