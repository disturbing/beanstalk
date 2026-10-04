# Review checklist: Clean Code smells in TypeScript

Run through this before calling TypeScript work done. Codes are Clean Code chapter 17 (G = general, N = names, T = tests, C = comments) plus TypeScript-only items (S).

## Contents
- Comments and environment
- Functions and general
- Names
- Tests
- TypeScript-only smells

## Comments and environment

- C1 Inappropriate information (ticket history, author names): move to git or `docs/`.
- C2 Obsolete comment: delete or fix now.
- C3 Redundant comment restating the code: delete.
- C5 Commented-out code: delete.
- E1 Build needs more than one step: `pnpm check` from the root must pass.
- E2 Tests need more than one step: `pnpm test` runs everything without env flags.

## Functions and general

- F1 Too many arguments (more than three): options object.
- F2 Output arguments (mutating a parameter): return a new value.
- F3 Flag arguments (`boolean`): two-value union.
- F4 Dead function: delete (`noUnusedLocals` and oxlint catch most).
- G5 Duplication: extract a function or a generic; three similar `switch` arms are one function.
- G6 Wrong level of abstraction: a route handler doing git plumbing; a domain function building a `Response`.
- G8 Too much information: exports nobody imports; wide option bags.
- G9 Dead code: unused exports, feature flags nobody sets, `// TODO remove`.
- G11 Inconsistency: `fetch` here, `load` there; `Result` here, `throw` there for the same failure.
- G14 Feature envy: a function that mostly reads another feature's object belongs in that feature.
- G15 Selector arguments (`kind: string` deciding behaviour): separate functions or a union with `switch`.
- G16 Obscured intent: dense chains with no named intermediate. Name the steps.
- G19 Explanatory variables: `const isStale = now - pushedAt > MAX_AGE_MS;` before the `if`.
- G23 Prefer polymorphism (union + exhaustive `switch`) to `if`/`else` chains on a type tag.
- G25 Magic numbers: a named constant with a one-line reason.
- G28 Encapsulate conditionals: `if (isExpired(lease))`, not `if (lease.expiresAt < now)`.
- G29 Avoid negative conditionals.
- G30 Functions do one thing.
- G31 Hidden temporal coupling (`init()` before `run()`): encode in types or constructors.
- G33 Encapsulate boundary conditions once.
- G34 Functions descend one level of abstraction.
- G35 Configurable data at the top (`config.ts`), not buried in helpers.
- G36 Transitive navigation (`a.b.c.d`): expose what the caller needs.

## Names

- N1 Descriptive names; N2 at the right level of abstraction (`store`, not `d1Client`, when the caller does not care).
- N3 Standard nomenclature: the domain vocabulary from `docs/claude-10-beanstalk-thesis.md` (trunk, intent, sprout, bean, world, evidence, lease, decision).
- N4 Unambiguous; N5 long names for long scopes.
- N7 Names describe side effects: `createOrLoad`, not `load`, when it may create.

## Tests

- T1 Insufficient tests: every exported `Result` function has success and failure tests; every route has a 4xx test.
- T3 Do not skip trivial tests.
- T5 Boundary conditions (empty, one, maximum, unicode paths, 32 MB blobs, rate-limit edge).
- T6 A fixed bug gets a regression test with the issue in the name.
- T9 Tests are fast: no sleeps, no network, package under 30 s.

## TypeScript-only smells

- S1 `any`, `as` casts, `!`, `@ts-ignore`, `@ts-expect-error` without a reason.
- S2 `enum`, `namespace`, classes for data, default exports outside framework entry points, barrel files.
- S3 `let` where `const` works; mutation of shared arrays and objects; missing `readonly`.
- S4 `JSON.parse` or a request body used without a schema; a hand-written `Env`; a type copied from a Zod schema instead of inferred.
- S5 A floating promise; `forEach(async ...)`; a `fetch` without a timeout; `console.log` outside `log.ts`.
- S6 Module-level mutable state in a Worker; reading `env` deep inside domain code; business logic inside a Hono handler.
- S7 `null` where `undefined` belongs; `== null` games; optional fields used as tri-state booleans.
- S8 String concatenation into SQL or shell; secrets in source, config or logs.
- S9 A `catch` that logs and continues silently; an error without `cause`; a 5xx that leaks internals.
- S10 Tests that mock the module under test, fake a Cloudflare binding, or assert on log output.
