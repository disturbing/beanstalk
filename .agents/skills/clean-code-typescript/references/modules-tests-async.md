# Modules, dependency injection, Workers lifetimes and tests (TypeScript)

## Contents
- Module layout
- Dependency injection and composition root
- Workers lifetimes and concurrency
- Promises
- Tests

## Module layout

```
packages/<name>/src/
  index.ts            # Worker entry: WorkerEntrypoint subclass + DO classes; the only default export
  app.ts              # createApp(): builds the Hono app, mounts routes, installs middleware and onError
  routes/<area>.ts    # one Hono sub-app per area; thin handlers
  middleware/         # request-id, auth, logging
  <feature>/          # domain code: pure functions and types, no Hono, no bindings
    <feature>.ts
    <feature>.test.ts
    wire.ts           # Zod schemas and inferred types for this feature's boundary
  adapters/           # wrappers around bindings and SDKs (artifacts.ts, claude.ts, queue.ts)
  log.ts
```

- Modules by feature, never by kind. `utils.ts`, `helpers.ts`, `types.ts` and `constants.ts` are smells; name what the file holds.
- Dependencies point inward: `routes` depend on `<feature>`, `<feature>` depends on nothing in `routes` or `adapters` (it receives ports as parameters). `import/no-cycle` enforces the absence of cycles.
- Files under about 300 lines; split along the feature seam.
- Named exports only. No barrel `index.ts` files: they create cycles and hide the dependency graph.
- Shared code across packages lives in `packages/shared-<topic>` and is imported as `@beanstalk/shared-<topic>` with `workspace:*`.

## Dependency injection and composition root

- The Worker entry (`src/index.ts`) is the composition root: it builds adapters from `env` and passes them into `createApp(deps)`. Nothing else reads `env` directly except middleware that puts typed values on `c.var`.
- Domain functions receive what they need as parameters (a `BlobStore`, a `Clock`, a `Random`), so unit tests pass fakes without `vi.mock`.
- No module-level mutable state (Workers reuse isolates across requests; module state leaks between requests and can trigger I/O ownership errors). Module-level constants and pure functions are fine.
- Configuration (limits, timeouts, model ids) is declared once at the top of the package in a typed `config.ts` derived from `env`, never scattered as literals.

## Workers lifetimes and concurrency

- Work that must finish after the response is handed to `ctx.waitUntil(promise)`; it is never left dangling.
- Request-scoped state is passed explicitly or stored on `c.var`; never on a module variable.
- Durable Objects run one event at a time per object: keep handlers short, use `blockConcurrencyWhile` only in the constructor for initialisation, and keep storage writes idempotent so retries are safe.
- Queue consumers are idempotent: dedupe on a message id before acting; `ack` per message, `retry` with a delay on transient failures, dead-letter on poison messages.
- Stream large bodies (`Response.body` through `TransformStream`); never `await response.text()` on unbounded data.
- Every outbound call carries `AbortSignal.timeout(ms)`; a named constant explains the value.
- Independent work runs concurrently with `Promise.all`; `Promise.allSettled` when partial success is acceptable and each failure is handled.
- Rate budgets (Artifacts 2,000 requests per 10 s per repo) are enforced in the adapter, not sprinkled through callers.

## Promises

- `async`/`await` everywhere; `.then` only when composing with `Promise.all`.
- No floating promises (`no-floating-promises`): await it, return it, or `void` it with a comment saying why dropping it is safe (rare; prefer `ctx.waitUntil`).
- No `async` callback passed where a sync one is expected (`no-misused-promises`): `array.forEach(async ...)` is a bug.
- No `new Promise` wrappers around APIs that already return promises; `scheduler.wait` / `setTimeout` only in tests or backoff code with a cap.

## Tests

- Framework: vitest. Workers packages: `@cloudflare/vitest-pool-workers` with `defineWorkersConfig` and real Miniflare bindings (D1, DO, KV, R2, Queues). Never fake a binding; mock only external HTTP (AI Gateway, GitHub, TypeSafe) with `fetchMock` from `cloudflare:test`.
- Layout: unit tests beside the code (`<feature>.test.ts`) for pure logic; e2e tests in `test/` that call `SELF.fetch(...)` or a DO stub from `env`.
- Names are behaviours: `it('lands a world only after every bean has passing evidence')`. One behaviour per test; several `expect`s on one result are fine.
- Arrange, act, assert, separated by blank lines. Builders for fixtures (`aBean({ parent: trunkSha })`) instead of 30-line literal objects.
- FIRST: fast (package under 30 s), independent (`isolatedStorage: true`), repeatable (`vi.useFakeTimers()` and injected clocks, seeded randomness), self-validating, timely.
- Every exported function that returns a `Result` has a success and a failure test; every route has at least one 4xx test.
- No sleeps, no retries-until-green, no `test.skip` without a linked reason.
- Snapshot tests only for rendered output (JSON bodies, generated markdown); review snapshot diffs like code.
