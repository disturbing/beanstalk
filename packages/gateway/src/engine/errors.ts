/** A broken engine invariant: a bug, never an expected outcome. The shell turns it into a fault. */
export class EngineInvariantError extends Error {
  override readonly name = 'EngineInvariantError';
}

/** Exhaustiveness guard for `switch` over a union. */
export function assertNever(value: never): never {
  throw new EngineInvariantError(`unexpected variant: ${JSON.stringify(value)}`);
}
