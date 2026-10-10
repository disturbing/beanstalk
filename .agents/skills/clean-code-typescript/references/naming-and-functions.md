# Naming, functions, comments and formatting (TypeScript)

## Contents
- Naming
- Functions
- Parameters and return values
- Comments and TSDoc
- Formatting

## Naming

| Clean Code rule | In TypeScript |
|---|---|
| Intention-revealing names | `elapsedSincePushMs`, not `d`. Put units in the name when the type cannot carry them; prefer a branded `Milliseconds` type when it matters. |
| Avoid disinformation | A `Map` is not a `list`; `beans` is an array, `beanById` is a map, `beanIds` is a set of ids. |
| Meaningful distinctions | No `data`, `info`, `item`, `obj`, `the`, numbered names. |
| Pronounceable, searchable | No abbreviations beyond the domain's own (`sha`, `id`, `repo`, `url`). One-letter names only in short arrow functions. |
| Nouns for types, verbs for functions | `type WorldPlan`, `function composeWorld()`. Handlers are verbs too: `landWorld`, not `worldHandler`. |
| One word per concept | `fetch` or `load` or `read`, chosen once. |
| No encodings | No `IFoo`, no `TFoo`, no `fooImpl`, no `_private` prefix (use `#private` or module scope). |
| Booleans read as questions | `isReady`, `hasConflicts`, `canLand`. |
| Casing | `camelCase` for values and functions, `PascalCase` for types and React components, `SCREAMING_SNAKE_CASE` only for true compile-time constants, `kebab-case` file names. |
| Consistent word order | `verbObject`: `applyBean`, `revokeLease`. |

## Functions

- One thing, one level of abstraction. Extract anything that can carry a meaningful name.
- About 25 lines; 50 is the ceiling and needs a reason in review.
- Stepdown rule: exported functions first, then the helpers they call, in call order.
- Early return with guard clauses. No `else` after `return`.
- `map`/`filter`/`reduce` for transforms; a `for ... of` loop when it is clearer or when it must stop early. Never `forEach` with side effects on outer state.
- Command/query separation: a function either changes state or answers a question. `takeLease()` returns the lease; `isLeased()` only reads.
- No hidden side effects: a function that writes storage, enqueues or logs says so in its name (`persist`, `enqueue`, `record`).
- Pure functions first: keep IO at the edges (handlers, repositories, clients) and the domain pure, so most tests need no bindings.
- Prefer function declarations for exported functions (hoisted, named in stack traces); arrow functions for callbacks.

## Parameters and return values

| Rule | Form |
|---|---|
| Three parameters maximum | Fourth parameter means an options object: `composeWorld(plan, { validation: 'strict' })`. |
| No boolean flags | `mode: 'dry-run' \| 'apply'`; call sites read `composeWorld(plan, { mode: 'apply' })`. |
| No out-parameters, no argument mutation | Return a new value; spread to copy. |
| Narrow inputs | Accept `ReadonlyArray<Bean>`, `readonly` objects, `Pick<...>` of what you use. |
| `undefined` for absence, never `null` | Return `T \| undefined` from lookups; use `??`. `null` only where a wire format demands it. |
| Return early with a `Result` for expected failures | See errors-and-boundaries.md. |
| Async everywhere it touches IO | Never block; never `.then()` chains when `await` reads better. |

## Comments and TSDoc

Good: TSDoc on exported functions and types (`@param` only when the name is not enough, `@throws` for thrown errors, `@returns` when non-obvious); a `//` explaining a why or a trade-off; a warning of consequences; a `TODO(owner): ...` linked to an issue.

Bad: restating the code, journal entries, section banners, closing-brace markers, commented-out code, notes that belong in `docs/`.

## Formatting

`oxfmt` with the repo `.oxfmtrc.json` (100 columns, single quotes, semicolons, trailing commas) is the only style. Import order: node built-ins (`node:`), external packages, workspace packages (`@gitstalk/*`), relative paths; blank line between groups; `import type` for types (`consistent-type-imports`). One blank line between declarations, never two. Related lines stay together.
