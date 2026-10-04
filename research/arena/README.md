# Arena: Beanstalk Shop

A small, realistic TypeScript service ("Beanstalk Shop", an online shop API) plus **40 coding tasks with designed contention**.
It is step 4 of the contention research (see `../README.md`) and has two jobs:

1. **Ground truth for the instruments.** Every task has a reference solution, so each change's footprint, the textual conflicts between changes and the "merges cleanly but breaks tests" pairs are known exactly. The replay tool (step 1) and the footprint predictor (step 2) can be scored against it.
2. **The playing field for the agent race** (`../race/`). Headless coding agents are given each task's issue-style `prompt`, with its acceptance tests already in their workspace, under two integration policies.

```
arena/
  app/                    base source: zero-dependency TypeScript, tests run with node --test
  tasks/tNNN.json         40 tasks: prompt, acceptance tests, oracle footprint, designed couplings
  solutions/tNNN.patch    reference solutions: `git apply` diffs against base, source files only
  materialize.py          builds ../corpora/arena.git (main = base, ref/tNNN = base + tests + solution)
  validate.py             proves the properties below for every task and every designed coupling
  contention.py           contention profile of the 40 tasks (overlaps, git merge-tree over all pairs)
  author/                 the task sources: tasks/ and solutions/ are generated from here
  tests/                  unit tests for the scripts (python3 -m unittest discover -s tests)
```

## The app

Beanstalk Shop has no server. A handler takes a Request-like object and returns a Response-like object, a tiny router (`src/router.ts`) matches them, and the tests call the router directly (`createApp().handle(...)`, or `createTestApp().call(...)` from `src/lib/testing.ts`). There is one in-memory database with numbered migrations, an injectable clock and a memory mailer, so everything is deterministic.

A customer registers, logs in, browses the catalog, fills a cart and checks out: stock is reserved, a coupon may apply, an invoice is issued with tax worked out per line from the shipping address, shipping is quoted, the order is confirmed and a confirmation email is queued. Admins mark invoices paid, ship orders, manage products and stock. Cancelling an order releases its stock and voids its invoice.

| Module (`src/…`) | What it owns | Files |
|---|---|---|
| `billing` | invoices, tax rates by country/region, coupons and discounts, payment status | `tax.ts` `discounts.ts` `invoice.ts` `service.ts` `handlers.ts` |
| `orders` | checkout, order lookup, cancellation | `checkout.ts` `service.ts` `handlers.ts` |
| `cart` | one cart per user, priced from the catalog | `service.ts` `handlers.ts` |
| `catalog` | products, search, listing | `service.ts` `search.ts` `handlers.ts` |
| `users` | registration, profile, addresses | `service.ts` `handlers.ts` |
| `auth` | password hashing, sessions, request guard, login/logout | `password.ts` `sessions.ts` `guard.ts` `handlers.ts` |
| `notifications` | email templates, queue and delivery | `templates.ts` `queue.ts` `handlers.ts` |
| `inventory` | stock levels, reservations, low-stock report | `stock.ts` `handlers.ts` |
| `shipping` | zone and weight rates, shipments | `rates.ts` `service.ts` `handlers.ts` |

Shared files that real repos make hot, on purpose:

| File | Why it is hot |
|---|---|
| `src/routes.ts` | the central route registry, grouped by module; every new endpoint adds a line |
| `src/types.ts` | all shared domain types, grouped by module; new fields and types land here |
| `src/db/migrations/index.ts` | the migration registry (`src/db/migrations/000N_*.ts` + one import and one array entry per schema change) |
| `src/lib/money.ts` | rounding, allocation and formatting of money; changing its contract affects every module |
| `src/config.ts` | settings and environment overrides |
| `CHANGELOG.md` | user-visible changes, in `Added` / `Changed` / `Fixed` lists under `Unreleased` |
| `README.md` | endpoint table, configuration table, behaviour notes |

Conventions: Node 25 runs the `.ts` files directly (type stripping), so there are no enums, namespaces, parameter properties or decorators, type-only imports use `import type`, and relative imports carry the `.ts` extension. Money is integer cents. Tests sit next to the code as `*.test.ts`; shared test helpers are in `src/lib/testing.ts`. There are 46 source files and 20 test files: 2,432 lines of code (2,876 raw lines with blanks and comments), 80 tests that run in about a second (`node --test` from `app/`, budget 5 s).

## Tasks

`tasks/tNNN.json` follows the schema in `../README.md`:

| Field | Meaning |
|---|---|
| `id`, `title`, `prompt` | what the agent is told: an issue-style title and ticket. 12 of 40 prompts name a file or module path, the rest describe behaviour only |
| `acceptance_tests` | `{path: content}`, added to the agent's workspace before it starts. Each fails on base and passes with the reference solution. They are new files in the module's directory, except `t002`, which also replaces `src/lib/pagination.test.ts` because the helper's return shape changes |
| `oracle_paths`, `oracle_modules` | evaluation only, never shown to agents or the scheduler: every path in the `ref/tNNN` commit (solution plus acceptance tests) and those paths mapped to their first two directory segments, i.e. what `common/corpus.py --module-depth 2` reports |
| `kind`, `difficulty` | 20 features, 13 bug fixes, 5 small refactors, 2 chores; difficulty 1 x 18, 2 x 21, 3 x 1 |
| `couplings` | designed interactions with another task, `type` `semantic` or `textual`, declared on both tasks |

Ids were assigned by a seeded search so that any ten consecutive ids carry a similar mix of billing and hot-file tasks; taking the tasks in id order does not front-load the contention.

| id | kind | d | files | modules | title |
|---|---|---|---|---|---|
| t001 | feature | 1 | 2 | 1 | Limit how many times a coupon can be redeemed |
| t002 | feature | 2 | 6 | 4 | Paged lists should report the total number of results |
| t003 | feature | 2 | 5 | 3 | Invoices should show federal and regional tax separately |
| t004 | refactor | 1 | 2 | 1 | Split the per-line work out of buildInvoice |
| t005 | feature | 1 | 4 | 3 | Show thousands separators in displayed amounts |
| t006 | chore | 1 | 4 | 3 | Make the invoice payment terms configurable |
| t007 | feature | 2 | 7 | 3 | Customers want to leave delivery notes on an order |
| t008 | bug | 1 | 2 | 1 | Reserving zero or negative quantities should be rejected |
| t009 | feature | 2 | 3 | 2 | Limit how many units of one product fit in an order |
| t010 | feature | 2 | 7 | 4 | Wholesale customers should not be charged sales tax |
| t011 | refactor | 3 | 9 | 5 | Tracking numbers belong to shipments, not orders |
| t012 | chore | 1 | 2 | 1 | Work out session expiry in one place |
| t013 | feature | 2 | 5 | 3 | Customers should get a receipt when their invoice is paid |
| t014 | feature | 2 | 4 | 2 | Active customers are logged out in the middle of a session |
| t015 | refactor | 1 | 4 | 1 | Move the coupon rules out of discounts.ts into their own module |
| t016 | feature | 2 | 2 | 1 | Invoice numbers should restart every year |
| t017 | bug | 1 | 3 | 2 | Customers in Quebec are charged the wrong sales tax |
| t018 | feature | 1 | 2 | 1 | Shipping emails should include the tracking number |
| t019 | feature | 2 | 6 | 3 | Let customers reorder a previous order |
| t020 | feature | 1 | 3 | 2 | Reject weak passwords at registration |
| t021 | bug | 1 | 2 | 1 | Retired products are still visible by id |
| t022 | feature | 2 | 6 | 3 | Customers cannot list their invoices |
| t023 | bug | 2 | 4 | 3 | Tax on multi-line invoices is a cent off from the tax authority's figure |
| t024 | feature | 2 | 6 | 3 | Cap the discount a percentage coupon can give |
| t025 | refactor | 1 | 2 | 1 | Replace the notification switch with a template table |
| t026 | bug | 1 | 2 | 1 | Line discounts do not add up to the order discount |
| t027 | bug | 1 | 2 | 1 | Customers can register twice with different capitalisation |
| t028 | feature | 2 | 6 | 3 | Require a signature for high-value deliveries |
| t029 | bug | 2 | 2 | 1 | A failed checkout leaves stock reserved |
| t030 | bug | 1 | 2 | 1 | Checking out an empty cart creates a stray invoice |
| t031 | feature | 2 | 6 | 3 | Customers want a plain-text copy of their invoice |
| t032 | bug | 2 | 4 | 3 | The order total shown to customers leaves out shipping |
| t033 | feature | 2 | 3 | 2 | Free standard shipping on orders over $75 |
| t034 | bug | 2 | 2 | 1 | Stock reservations should be all or nothing |
| t035 | bug | 2 | 4 | 3 | Carts accept more units than are in stock |
| t036 | feature | 2 | 7 | 3 | Support refunding a single invoice line |
| t037 | refactor | 1 | 2 | 1 | Make product filtering a pure function |
| t038 | bug | 1 | 2 | 1 | Fixed-amount coupons can push an order total below zero |
| t039 | feature | 2 | 5 | 3 | Finance needs a list of overdue invoices |
| t040 | bug | 1 | 2 | 1 | Expired coupons are still accepted at checkout |

## Contention design

Real repositories measured this week: the hottest module is touched by about 45-50% of changes, the average change touches about 2.2 modules and 4 files. The arena is built to match, using `common/corpus.py --module-depth 2` as the yardstick (so a test file counts for the module it sits in, and `CHANGELOG.md` / `README.md` count for `(root)`).

| Property | Target | Arena |
|---|---|---|
| `billing` touched by | ~45% of tasks | 45.0% (18 tasks) |
| `orders` touched by | ~25% | 25.0% (10 tasks) |
| then a tail | | catalog, inventory, shipping, auth, notifications 7.5% each, users 5%, cart 2.5% |
| modules per change | ~2.2 | 2.12 |
| files per change | ~4 | 3.83 |
| tasks touching a hot file (routes, types, migrations index, CHANGELOG, money) | 35-45% | 42.5% (17 tasks): CHANGELOG 30.0%, types 22.5%, routes 12.5%, migrations index 10.0%, money 5.0% |
| tasks in disjoint areas | at least ~30% | 30% (12 cold tasks: no hot file, no billing/orders, no shared-infrastructure module) |
| designed semantic couplings | 5 | 5 |
| designed textual couplings | ~5 | 5 |

Module touch distribution (module = first two directory segments of a path):

| module | tasks | share |
|---|---|---|
| `src/billing` | 18 | 45.0% |
| `(root)` | 17 | 42.5% |
| `src` | 15 | 37.5% |
| `src/orders` | 10 | 25.0% |
| `src/db` | 4 | 10.0% |
| `src/lib` | 3 | 7.5% |
| `src/catalog` | 3 | 7.5% |
| `src/inventory` | 3 | 7.5% |
| `src/shipping` | 3 | 7.5% |
| `src/auth` | 3 | 7.5% |
| `src/notifications` | 3 | 7.5% |
| `src/users` | 2 | 5.0% |
| `src/cart` | 1 | 2.5% |

The hot files are touched for the reasons real repos touch them: new endpoints go in `routes.ts` (and the README table), schema changes need a migration file plus a registry entry (and a new field in `types.ts`), user-visible changes add a `CHANGELOG.md` line, and new settings add a `config.ts` entry and a README row. All four migration tasks pick version 6, as developers working from the same base would, so merging any two of them conflicts in the registry and, resolved by union, fails on the duplicate version.

Edits land in different regions of the hot files, so they conflict only when they hit the same spot: `CHANGELOG.md` entries conflict only inside the same list (`Added` / `Changed` / `Fixed`), `routes.ts` and `types.ts` are grouped by module, and the README rows are separate. Measured with `git merge-tree --write-tree` over all 780 pairs of `ref/*` branches (`contention.py`):

| | pairs | textual conflicts | rate |
|---|---|---|---|
| all pairs | 780 | 58 | 7.4% |
| share a file | 189 | 58 | 30.7% |
| share a module, no file | 147 | 0 | 0.0% |
| disjoint | 444 | 0 | 0.0% |

336 pairs (43.1%) share a module and 189 (24.2%) share a file. 22 of the 58 conflicting pairs conflict only in `CHANGELOG.md`, which a union merge driver dissolves; the rest are in source, migrations or the README. 4 tasks never conflict textually with any other. The numbers are also in `../data/arena/profile.json` after a run of `contention.py`.

## Designed couplings

Each coupling is declared on both tasks (`couplings[]`) and checked by `validate.py`.

**Semantic: merges cleanly, breaks tests.** Task A changes a contract; task B is ordinary product work whose acceptance test legitimately encodes the old contract. `ref/A` and `ref/B` each pass alone, `git merge-tree` of the two is clean, and the merged tree fails at least one test.

| A changes a contract | B relies on the old one | The contract | How the merge breaks |
|---|---|---|---|
| t023 `tax-rounding` | t036 `line-refunds` | Tax is rounded once per tax rate and spread over the lines (`applyRateToTotal` in `lib/money.ts`), instead of per line. | The refund test expects three identical $3.33 lines to refund $3.76 each (net + 43c tax); after the change one of them carries 44c of tax. |
| t032 `total-with-shipping` | t028 `signature` | `Order.total` now includes shipping (a change in the meaning of a shared type field). | The signature test sits just under the $250 threshold ($249.21); with $5 shipping included the order crosses it. |
| t011 `tracking-on-shipment` | t018 `tracking-email` | `trackingNumber` moves from `Order` to `Shipment`. | The shipped-email template reads `order.trackingNumber`, which no longer exists, so the email loses its tracking number. |
| t002 `paginate-total` | t022 `invoice-list` | `paginate()` returns `{ items, total }` instead of an array; the two existing callers are updated. | The new `GET /invoices` endpoint returns `paginate()`'s result as its body, which is now an object, not an array. |
| t005 `money-grouping` | t031 `invoice-text` | `formatMoney` groups thousands (`$1,000.00`). | The plain-text invoice test expects `$1000.00`. |

**Textual: edit the same function or lines.** `git merge-tree` of the two branches reports a conflict, in a source file.

| Task | Task | Where | How |
|---|---|---|---|
| t017 `quebec-tax` | t003 `tax-breakdown` | `billing/tax.ts`, the Quebec row of the rate table | one corrects the rate, the other turns every row into a federal/regional pair |
| t040 `coupon-expiry` | t001 `coupon-redemption-limit` | `billing/service.ts`, `issueInvoice()` | both add a coupon check right after the unknown-coupon check |
| t030 `empty-cart` | t009 `line-limit` | `orders/checkout.ts`, top of `checkout()` | both add a validation right after the cart is loaded |
| t034 `reserve-atomic` | t008 `reserve-validation` | `inventory/stock.ts`, the loop in `reserve()` | one splits it into check and reserve passes, the other validates inside it |
| t020 `password-policy` | t027 `email-case` | `users/service.ts`, top of `registerUser()` | one normalises the email line, the other adds a password check right after it |

Beyond these ten, many pairs interact naturally (shared hot files, several tasks changing the same function). They are not declared couplings and are not validated individually; `contention.py` counts them.

## How to run

From `research/`:

```
(cd arena/app && node --test)                 # base: 80 tests, about a second
python3 arena/materialize.py                  # (re)builds corpora/arena.git, deterministic
python3 arena/validate.py                     # prints the tables, exits non-zero on any failure
python3 common/corpus.py corpora/arena.git --corpus arena --branches 'refs/heads/ref/*' --base main \
    --module-depth 2 -o data/arena/corpus.jsonl
python3 arena/contention.py                   # overlap profile and merge-tree conflict counts
(cd arena && python3 -m unittest discover -s tests)   # unit tests for the scripts, about 20 s
```

`materialize.py` makes `main` the base app at the repository root (`src/billing/tax.ts`, `package.json`, `CHANGELOG.md`, ...) and one branch `ref/tNNN` per task: base + acceptance tests + reference solution, one commit with the task title as its message and a fixed author and date, so rebuilding gives identical commit ids.

`validate.py` works in a temporary clone with temporary worktrees and removes them afterwards. It proves, for every task, that the acceptance tests fail on base and that base plus the solution passes the full suite, and for every coupling the semantic or textual property above. It also checks that each patch applies to a pristine base with `git apply` and touches no test files, that each branch is one commit on `main` titled like the task and matching `oracle_paths`, and that the base suite stays inside its 5 s budget (measured serially).

## Changing or adding tasks

`tasks/` and `solutions/` are generated, not hand-edited. Each task is written once in `author/tasks_*.py` as edit operations on `app/` plus its acceptance tests; `author/build_all.py` applies them in a temp repo, takes the patch from `git diff`, checks the task (acceptance tests fail on base, base plus solution passes the suite), assigns the ids and writes the JSON and the patches. `author/check.py <slug>` checks single tasks without writing anything. After a change, run `build_all.py`, `materialize.py` and `validate.py` in that order. Changing `app/` invalidates the patches' context, so rebuild after that too.

## Notes

- A solution patch contains source changes only. Where a task has to change an existing test (only `t002`), the new version of that file is part of the task's `acceptance_tests`.
- Acceptance tests use only names that the prompt gives (functions, fields, messages, statuses); error bodies are checked by message, not by the internal error code.
- Tasks are authored against the base alone and do not know about each other. Their reference solutions are one possible implementation: agents' solutions will differ, so the designed couplings are guaranteed for the reference solutions and likely, not certain, for others.
