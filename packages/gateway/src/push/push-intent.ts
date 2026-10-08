/**
 * What a push says about its bean: the intent comes from the head commit's message (the
 * subject is the bean's title, subject and body together its intent) and a `Task: <id>`
 * trailer links a task. Push options (`git push -o`) override both and ask the push to wait.
 */

/** Longest intent kept (the engine's task prompt limit is 100,000 characters). */
const MAX_INTENT_CHARS = 20_000;
const MAX_TITLE_CHARS = 200;
/** `-o wait` with no value holds the push this long for the verdict. */
export const DEFAULT_WAIT_SECONDS = 600;
/** A push to `refs/wait/any|all` holds this long by default: under a 10-minute tool call. */
export const DEFAULT_WAIT_REF_SECONDS = 540;
/** Longest wait a push may ask for. */
export const MAX_WAIT_SECONDS = 1800;
/** Beans one wait may name (`-o bean=<name>`). */
const MAX_WAIT_BEANS = 64;
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._:#/-]{0,63}$/;

export type PushIntent = {
  readonly title: string;
  readonly intent: string;
  /** The task the bean is for (`Task:` trailer or `-o task=`), if any. */
  readonly task: string | null;
};

export type PushOptions = {
  /** Seconds to hold the push for the pre-land verdict; null: answer at once. */
  readonly waitSeconds: number | null;
  readonly task: string | null;
  readonly intent: string | null;
  /** Beans a push to `refs/wait/` names (`-o bean=<name>`, repeated). */
  readonly beans: readonly string[];
  /** Options the gateway does not know, reported back to the pusher. */
  readonly unknown: readonly string[];
};

/**
 * Reads `git push -o` values: `wait`, `wait=<seconds>`, `task=<id>`, `intent=<text>`, and for
 * a wait ref `bean=<name>` (repeated; a comma-separated list works too).
 */
export function parsePushOptions(options: readonly string[]): PushOptions {
  let waitSeconds: number | null = null;
  let task: string | null = null;
  let intent: string | null = null;
  const beans: string[] = [];
  const unknown: string[] = [];
  for (const option of options) {
    const [key = '', ...rest] = option.split('=');
    const value = rest.join('=').trim();
    if (key === 'wait') waitSeconds = waitFor(value);
    else if (key === 'task' && TASK_ID.test(value)) task = value;
    else if (key === 'intent' && value !== '') intent = value.slice(0, MAX_INTENT_CHARS);
    else if (key === 'bean' && value !== '') beans.push(...beanNames(value));
    else unknown.push(option);
  }
  return {
    waitSeconds,
    task,
    intent,
    beans: [...new Set(beans)].slice(0, MAX_WAIT_BEANS),
    unknown,
  };
}

/** `bean=a`, `bean=a,b` or `bean=bean/a`: the names, without a branch prefix. */
function beanNames(value: string): string[] {
  return value
    .split(',')
    .map((name) => name.trim().replace(/^(refs\/heads\/)?beans?\//, ''))
    .filter((name) => name !== '');
}

function waitFor(value: string): number {
  if (value === '') return DEFAULT_WAIT_SECONDS;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds > 0
    ? Math.min(seconds, MAX_WAIT_SECONDS)
    : DEFAULT_WAIT_SECONDS;
}

/** The bean's title, intent and task from its head commit's message and the push options. */
export function pushIntent(message: string, options: PushOptions): PushIntent {
  const text = (options.intent ?? message).replaceAll('\r\n', '\n').trim();
  const [subject = '', ...body] = text.split('\n');
  const title = subject.trim().slice(0, MAX_TITLE_CHARS) || 'untitled bean';
  return {
    title,
    intent: withoutTrailers(text).slice(0, MAX_INTENT_CHARS) || title,
    task: options.task ?? taskTrailer(body.join('\n')),
  };
}

/** The `Task: <id>` trailer of a commit message body, if it has one. */
export function taskTrailer(body: string): string | null {
  const paragraphs = body.trim().split(/\n\s*\n/);
  const last = paragraphs.at(-1) ?? '';
  for (const line of last.split('\n')) {
    const match = /^Task:\s*(\S+)\s*$/i.exec(line.trim());
    if (match?.[1] !== undefined && TASK_ID.test(match[1])) return match[1];
  }
  return null;
}

/** The message without a trailing trailer block (`Key: value` lines). */
function withoutTrailers(text: string): string {
  const paragraphs = text.split(/\n\s*\n/);
  const last = paragraphs.at(-1) ?? '';
  const isTrailerBlock =
    paragraphs.length > 1 && last.split('\n').every((line) => /^[A-Za-z-]+:\s*\S/.test(line));
  return (isTrailerBlock ? paragraphs.slice(0, -1) : paragraphs).join('\n\n').trim();
}
