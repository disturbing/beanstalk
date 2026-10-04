import { GatewayError } from '../errors';
import type { RunResult } from '../run/run-do';

/** The value of a RunDO result, or the error the one `onError` handler renders. */
export function unwrap<T>(result: RunResult<T>): T {
  if (result.ok) return result.value;
  throw new GatewayError(result.error.message, result.error.code, result.error.status);
}
