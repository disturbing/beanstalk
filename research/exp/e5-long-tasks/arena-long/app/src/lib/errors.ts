export class AppError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string): AppError => new AppError(400, 'bad_request', message);
export const unauthorized = (message = 'authentication required'): AppError =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'not allowed'): AppError => new AppError(403, 'forbidden', message);
export const notFound = (what: string): AppError => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string): AppError => new AppError(409, 'conflict', message);
