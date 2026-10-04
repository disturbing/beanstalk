# Types and data (TypeScript)

## Contents
- Shapes: type versus interface
- Discriminated unions and exhaustiveness
- Branded identifiers
- Result values
- Immutability
- Zod-derived types
- Generics and utility types

## Shapes: type versus interface

- `type` for data shapes, unions, and anything derived; `interface` only for a contract that classes implement (a `BlobStore` port) or where declaration merging is required by a library.
- No `enum`: use `as const` objects or string-literal unions. `erasableSyntaxOnly` in the base tsconfig rejects `enum` and `namespace` anyway.
- No classes for data. Classes only where the platform requires them (`DurableObject`, `WorkerEntrypoint`, `Container`) or for `Error` subclasses.
- Objects and data structures are different things (Clean Code chapter 6): a data shape exposes fields and has no behaviour; a module with behaviour hides its data behind functions. Do not build hybrids.
- Keep the Law of Demeter: a function talks to its parameters and what it creates, not `a.b.c.d`. Expose `plan.trunkSha()` style accessors on modules instead of deep reach-ins.

## Discriminated unions and exhaustiveness

```ts
type Sprout =
  | { readonly kind: 'claimed'; readonly lease: Lease }
  | { readonly kind: 'working'; readonly since: IsoTimestamp }
  | { readonly kind: 'landed'; readonly world: WorldId };

export function describe(sprout: Sprout): string {
  switch (sprout.kind) {
    case 'claimed':
      return `claimed until ${sprout.lease.expiresAt}`;
    case 'working':
      return `working since ${sprout.since}`;
    case 'landed':
      return `landed in ${sprout.world}`;
    default:
      return assertNever(sprout);
  }
}

export function assertNever(value: never): never {
  throw new Error(`unexpected variant: ${JSON.stringify(value)}`);
}
```

`switch-exhaustiveness-check` fails the lint when a variant is missing. Transitions are functions `claim(sprout): Sprout` that return a new value.

## Branded identifiers

```ts
declare const brand: unique symbol;
type Brand<T, Name extends string> = T & { readonly [brand]: Name };

export type BeanId = Brand<string, 'BeanId'>;
export type TrunkSha = Brand<string, 'TrunkSha'>;

export const BeanId = z.string().regex(/^bean_[a-z0-9]{12}$/).brand<'BeanId'>();
```

Every identifier that crosses a function boundary is branded; parse it with its Zod schema at the edge (`BeanId.parse(raw)`) and never cast with `as BeanId` outside that schema.

## Result values

```ts
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });
```

Use `Result` when the caller must handle the outcome (not found, conflict, lease expired, rate limited). The `E` is a discriminated union of expected failures with a `kind` field, not a string. Throw for bugs and infrastructure failures. Never mix: a function returns `Result` or throws, and its TSDoc says which.

## Immutability

- `const` always; `let` only for a loop counter or a value assigned in both branches of a conditional (prefer a ternary or a function).
- `readonly` on every field of a data type; `ReadonlyArray<T>` and `ReadonlyMap<K, V>` in signatures; `as const` on literal tables.
- Produce new values with spread, `with`, `toSorted`, `toSpliced`; never `push`, `sort` or `splice` on a value someone else holds.
- Freeze nothing at runtime; rely on types. Runtime cost belongs to the hot path.

## Zod-derived types

- One schema per boundary shape, in the module that owns the boundary (`wire.ts`, `queue-messages.ts`, `mcp-tools.ts`). `export type CreateBeanRequest = z.infer<typeof CreateBeanRequest>` next to it; the schema and the type share a name.
- `z.strictObject({...})` for request bodies; loose objects never. Dates as ISO strings parsed with `z.iso.datetime()`; ids via their branded schemas.
- Parse at the edge once (`schema.parse` for trusted internal data, `safeParse` for user input, returning a 400 with the issues). Inner code receives typed values and does not re-validate.
- Model outputs (Claude, Jev) are untrusted input: a schema, `safeParse`, and a fallback path on failure.

## Generics and utility types

- A generic parameter must appear at least twice in the signature; otherwise use `unknown` or a concrete type.
- Prefer `Pick`, `Omit`, `Readonly`, `Partial` on existing shapes over new near-duplicate types. Never re-declare a shape that a schema or a generated file already defines (`worker-configuration.d.ts`, `z.infer`).
- `satisfies` to check a literal against a type without widening: `const routes = {...} satisfies Record<string, Handler>`.
- Template literal types for structured strings (`` `world-${string}` ``) when they prevent a class of bugs; otherwise a brand.
