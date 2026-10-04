/** Structured JSON logs: the one module that writes to the console. Never log secrets. */
type Level = 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, unknown>>;

export const log = {
  info: (message: string, fields: LogFields = {}) => write('info', message, fields),
  warn: (message: string, fields: LogFields = {}) => write('warn', message, fields),
  error: (message: string, fields: LogFields = {}) => write('error', message, fields),
};

function write(level: Level, message: string, fields: LogFields): void {
  const line = JSON.stringify({ level, message, component: 'web', ...serializable(fields) });
  // oxlint-disable-next-line no-console -- this module is the package's one console writer
  console[level === 'info' ? 'log' : level](line);
}

function serializable(fields: LogFields): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      value instanceof Error ? { name: value.name, message: value.message } : value,
    ]),
  );
}
