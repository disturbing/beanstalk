---
name: clean-code-typescript
description: Clean Code (Robert C. Martin) translated into strict TypeScript for Gitstalk's Workers, Durable Objects and the vinext web app. Covers naming, small functions, discriminated unions and branded types, typed errors and Result values, Zod at boundaries, module layout, vitest tests, promise and Workers lifetime rules, plus the oxlint and tsconfig profile. Use when writing, reviewing or refactoring any .ts or .tsx file.
---

# Clean Code, in TypeScript

The root `tsconfig.base.json` and `.oxlintrc.json` (type-aware oxlint) are the mechanical half; this file is the judgement half. Platform wiring (Hono shape, wrangler config, package layout) lives in the `gitstalk-packages` skill.

## Rules that apply every time

1. **Names say what, not how.** `pendingBeans`, not `list`, `data` or `tmp`. Types are nouns in `PascalCase`, functions are verbs in `camelCase`, booleans read as questions (`isReady`, `hasConflicts`). Files are `kebab-case.ts`. No `I` prefix, no Hungarian, no abbreviations beyond the domain's own (`sha`, `id`, `repo`).
2. **Functions do one thing at one level of abstraction** and fit on a screen: about 25 lines, 50 is the ceiling. Exported functions at the top of the module, helpers below.
3. **At most three parameters;** a fourth means an options object. No boolean flags: a two-value union (`mode: 'dry-run' | 'apply'`). No mutation of arguments.
4. **`unknown` in, typed out.** No `any`, no `as` to silence the compiler, no `!`. Narrow with type guards and Zod. `satisfies` is the one allowed assertion.
5. **Model with unions, not class hierarchies.** Discriminated unions with a `kind` field; `switch` over them is exhaustive and ends in `assertNever`. Branded types for every identifier (`BeanId`, `TrunkSha`). No `enum`.
6. **Immutable by default.** `const`, `readonly` fields, `ReadonlyArray`, copies over mutation. No module-level mutable state: request state is passed, durable state lives in a Durable Object.
7. **Expected failures are values; bugs are thrown.** `Result<T, E>` for outcomes the caller must handle (not found, conflict, rate limited); thrown `Error` subclasses with `cause` for bugs and infrastructure failures; one handler at the edge turns them into responses. Never swallow a `catch`.
8. **Validate at the boundary, trust inside.** Every request body, queue message, stored JSON, MCP tool input and model output passes a Zod schema; types come from `z.infer`, never hand-copied. Bindings come from `wrangler types`, never a hand-written `Env`.
9. **Promises are never dropped.** Awaited, returned, or given to `ctx.waitUntil`. Independent work uses `Promise.all`; every outbound call carries an `AbortSignal` timeout.
10. **Comments explain why.** TSDoc on exported functions and types only. No commented-out code, no banners, no `oxlint-disable` without a reason on the same line.
11. **Modules by feature, not by kind.** `world/`, `bean/`, `gateway/`; never `utils/`, `helpers/`, `types/`. Named exports only; default exports only where a framework demands them (Worker entry `src/index.ts`, vinext `app/` routes, config files). No barrel files.
12. **Tests describe behaviour.** vitest; Workers packages use `@cloudflare/vitest-pool-workers` with real Miniflare bindings; mock only external HTTP. Names are sentences: `it('rejects a bean whose parent is not on trunk')`.

## Workflow

1. Shape the types first ([types-and-data.md](references/types-and-data.md)), then the error vocabulary ([errors-and-boundaries.md](references/errors-and-boundaries.md)), then the functions ([naming-and-functions.md](references/naming-and-functions.md)).
2. Place files and write the test beside the code per [modules-tests-async.md](references/modules-tests-async.md).
3. Before finishing, run [smells-checklist.md](references/smells-checklist.md) and the commands below.

## Verify

```bash
pnpm fmt:check && pnpm lint && pnpm typecheck && pnpm test
```

`pnpm check` at the repo root runs these plus the Rust checks. Fix the finding rather than disabling the rule; a rule that is wrong for the repo changes in `.oxlintrc.json` in its own commit with the reason.

## References

| File | Load when |
|------|-----------|
| [naming-and-functions.md](references/naming-and-functions.md) | Naming, function size and shape, parameters, comments, formatting |
| [types-and-data.md](references/types-and-data.md) | Unions, branded types, `Result`, readonly, Zod-derived types, `type` vs `interface` |
| [errors-and-boundaries.md](references/errors-and-boundaries.md) | Error classes, central handling, wrapping third-party SDKs, logging |
| [modules-tests-async.md](references/modules-tests-async.md) | Module layout, dependency injection, Workers lifetimes, promises, vitest |
| [smells-checklist.md](references/smells-checklist.md) | Review checklist mapping Clean Code smells to TypeScript |
