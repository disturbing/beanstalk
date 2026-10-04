/** Failures a data source reports; pages turn them into a 404 or an error panel. */
export type ForgeErrorCode = 'not_found' | 'bad_ref' | 'unavailable' | 'bad_response';

export class ForgeError extends Error {
  override readonly name = 'ForgeError';
  readonly code: ForgeErrorCode;

  constructor(message: string, code: ForgeErrorCode, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export function isForgeError(error: unknown, code?: ForgeErrorCode): error is ForgeError {
  return error instanceof ForgeError && (code === undefined || error.code === code);
}
