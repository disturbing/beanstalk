# Errors and boundaries (TypeScript)

## Contents
- Error handling rules
- Error classes
- Central handling in a Worker
- Boundaries: wrap what you do not own
- Logging

## Error handling rules

1. Expected outcomes are `Result` values (see types-and-data.md); bugs and infrastructure failures are thrown. A function does one or the other, and its TSDoc says which.
2. `catch (error: unknown)` always (`useUnknownInCatchVariables` is on). Narrow with `instanceof` or a type guard before reading fields.
3. Never swallow: a `catch` either rethrows with context (`new GatewayError('reading blob', { cause: error })`), converts to a `Result`, or handles the case fully and says so in a comment.
4. Add context where meaning changes. The caller needs "which repo, which sha", not "fetch failed".
5. Write the `try`/`catch` first when IO is involved, then fill in the happy path (Clean Code: define the failure scope before the logic).
6. Keep `try` blocks small: one operation per `try`, extracted into its own function when the body grows.
7. No error codes or sentinel values (`-1`, `''`, `null`). No `undefined` return to mean failure where failure needs a reason.
8. Define the normal case: an empty array for "nothing matched", not an error.
9. Validate inputs at the boundary with Zod and return a 400 with the issues; never throw a raw `ZodError` out of a handler.
10. Timeouts and cancellation are part of error handling: every `fetch` gets `signal: AbortSignal.timeout(ms)` with a named constant, and a timeout maps to 504 or a retry, never to a hang.

## Error classes

```ts
export class GitstalkError extends Error {
  override readonly name: string = 'GitstalkError';
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class NotFoundError extends GitstalkError {
  override readonly name = 'NotFoundError';
  constructor(what: string, id: string, options?: ErrorOptions) {
    super(`${what} ${id} not found`, 'not_found', 404, options);
  }
}
```

One base class per package (or in `@gitstalk/shared-core`), a handful of subclasses named by the caller's needs (`NotFoundError`, `ConflictError`, `UpstreamError`, `RateLimitedError`), each with a stable `code` and `status`. Carry data the caller can act on (ids, retry-after), not only text.

## Central handling in a Worker

One `app.onError` per Hono app maps errors to responses; handlers never build error responses themselves.

```ts
app.onError((error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  if (error instanceof GitstalkError) {
    if (error.status >= 500) log.error('request failed', { error, requestId: c.get('requestId') });
    return c.json({ error: { code: error.code, message: error.message } }, error.status);
  }
  log.error('unhandled error', { error, requestId: c.get('requestId') });
  return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
});
```

A 5xx never leaks its message. Validation failures from `zValidator` come back as 400 with the Zod issues through its `hook` option, in the same `{ error: { code, message, issues } }` shape.

Queue consumers and Workflows steps follow the same rule: catch at the top of the batch or step, log once with ids, decide `ack`, `retry` or dead-letter, never let an unhandled rejection decide for you.

## Boundaries: wrap what you do not own

Third-party SDKs and platform bindings are wrapped in a module with a narrow, typed interface (Clean Code chapter 8):

- `artifacts.ts` wraps `env.ARTIFACTS` and returns domain types (`TreeEntry`, `Blob`), handles `using` disposal of repo handles, converts platform errors to `GitstalkError`, and enforces the rate budget. Nothing else touches `env.ARTIFACTS`.
- `claude.ts` wraps the Anthropic SDK; `jev.ts` wraps TypeSafe; `gateway-client.ts` wraps calls to other Workers. Each exposes two or three functions, not the SDK.
- Learning tests: when adopting a library, write a small test in `test/learning/` that pins the behaviour you depend on; it fails when an upgrade changes it.
- Code to the interface you wish you had; write the adapter afterwards. The domain depends on `BlobStore`, not on `Artifacts`.
- Model and tool outputs cross a boundary: Zod `safeParse`, then a fallback path.

## Logging

- Structured JSON via one `log` module per package: `log.info('world composed', { worldId, beanCount, ms })`. Never `console.log` in production code (`no-console`); the log module is the one place that calls `console`.
- Every log line carries `requestId` (middleware generates it) and the domain ids in scope. Secrets, tokens and full request bodies are never logged.
- Log once at the handling site. Do not log and rethrow.
- Levels: `error` for failed requests and dropped work, `warn` for degraded paths taken (fallbacks, retries), `info` for state transitions (bean accepted, world landed), `debug` off in production.
