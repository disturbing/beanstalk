/**
 * Structured JSON logs, one object per line, picked up by Workers Logs. The only module
 * that writes to the console. Never pass tokens, secrets or request bodies as fields.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Readonly<Record<string, unknown>>;

export type Logger = {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every line. */
  with(fields: LogFields): Logger;
};

const RANK: Readonly<Record<LogLevel, number>> = { debug: 10, info: 20, warn: 30, error: 40 };

export function isLogLevel(value: string): value is LogLevel {
  return Object.hasOwn(RANK, value);
}

/** A logger writing lines at or above `level`. */
export function createLogger(level: LogLevel, base: LogFields = {}): Logger {
  const write = (lineLevel: LogLevel, message: string, fields: LogFields = {}): void => {
    if (RANK[lineLevel] < RANK[level]) return;
    const line = JSON.stringify({
      level: lineLevel,
      msg: message,
      ...base,
      ...serializable(fields),
    });
    // oxlint-disable-next-line no-console -- this module is the package's one console writer
    console[lineLevel === 'debug' ? 'log' : lineLevel](line);
  };
  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    with: (fields) => createLogger(level, { ...base, ...fields }),
  };
}

/** Errors become `{name, message}` (and their cause), everything else passes through. */
function serializable(fields: LogFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      value instanceof Error ? describeError(value) : value,
    ]),
  );
}

function describeError(error: Error): Record<string, unknown> {
  const cause = error.cause instanceof Error ? describeError(error.cause) : undefined;
  return { name: error.name, message: error.message, ...(cause === undefined ? {} : { cause }) };
}
