/** A failure with an HTTP meaning; the one `onError` handler turns it into a response. */
export class GatewayError extends Error {
  override readonly name: string = 'GatewayError';
  readonly code: string;
  readonly status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 422 | 500 | 502 | 503 | 504;

  constructor(
    message: string,
    code: string,
    status: GatewayError['status'],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.code = code;
    this.status = status;
  }
}

export class NotFoundError extends GatewayError {
  override readonly name = 'NotFoundError';

  constructor(what: string, id: string) {
    super(`${what} ${id} not found`, 'not_found', 404);
  }
}

export class UnauthorizedError extends GatewayError {
  override readonly name = 'UnauthorizedError';

  constructor(message = 'missing or invalid credentials') {
    super(message, 'unauthorized', 401);
  }
}

export class ForbiddenError extends GatewayError {
  override readonly name = 'ForbiddenError';

  constructor(message: string) {
    super(message, 'forbidden', 403);
  }
}

/**
 * A call to something the gateway does not own (Artifacts, the runner container) failed.
 * `retryable` says whether the same call may succeed later (busy, timeout, 5xx).
 */
export class UpstreamError extends GatewayError {
  override readonly name = 'UpstreamError';
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean, options?: ErrorOptions) {
    super(message, 'upstream_failed', 502, options);
    this.retryable = retryable;
  }
}
