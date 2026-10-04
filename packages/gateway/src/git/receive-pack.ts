/**
 * Reads the command list at the head of a `git-receive-pack` request (pkt-lines up to the
 * first flush: `<old> <new> <ref>`) so the proxy can refuse a push to a ref the pusher may
 * not update, then hands back a stream that replays every byte read, untouched, followed
 * by the rest of the body. Only the command section is buffered; the pack streams through.
 */

/** Longest command section accepted (a push of a few refs is well under 1 KiB). */
const MAX_COMMAND_BYTES = 64 * 1024;
const ZERO_SHA = '0'.repeat(40);

export type PushCommand = {
  readonly oldSha: string;
  readonly newSha: string;
  readonly ref: string;
};

export type PushInspection =
  | {
      readonly ok: true;
      readonly commands: readonly PushCommand[];
      readonly body: ReadableStream<Uint8Array>;
    }
  | { readonly ok: false; readonly reason: string };

type Parsed =
  | { readonly commands: PushCommand[]; readonly complete: boolean }
  | { readonly error: string };

export async function inspectPush(
  body: ReadableStream<Uint8Array> | null,
): Promise<PushInspection> {
  if (body === null) return { ok: true, commands: [], body: new Blob([]).stream() };
  const reader = body.getReader();
  let buffered: Uint8Array = new Uint8Array(0);
  for (;;) {
    const parsed = parseCommands(buffered);
    if ('error' in parsed) return refuse(reader, parsed.error);
    if (parsed.complete)
      return { ok: true, commands: parsed.commands, body: replay(buffered, reader) };
    if (buffered.length > MAX_COMMAND_BYTES) return refuse(reader, 'push command list too long');
    // oxlint-disable-next-line no-await-in-loop -- a stream is read one chunk at a time
    const { done, value } = await reader.read();
    if (done) return { ok: false, reason: 'push request ended inside its command list' };
    buffered = concat(buffered, value);
  }
}

/** Every command updates one of `allowed` and none deletes a ref; else the reason it may not. */
export function pushRefusal(
  commands: readonly PushCommand[],
  allowed: readonly string[],
): string | null {
  for (const command of commands) {
    if (!allowed.includes(command.ref))
      return `pushing ${command.ref} is not allowed (only ${allowed.join(', ')})`;
    if (command.newSha === ZERO_SHA) return `deleting ${command.ref} is not allowed`;
  }
  return null;
}

/** Parses pkt-lines from the start of `bytes` up to the first flush packet. */
export function parseCommands(bytes: Uint8Array): Parsed {
  const commands: PushCommand[] = [];
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    const lengthText = decoder.decode(bytes.subarray(offset, offset + 4));
    if (!/^[0-9a-fA-F]{4}$/.test(lengthText)) return { error: 'malformed pkt-line length' };
    const length = Number.parseInt(lengthText, 16);
    if (length === 0) return { commands, complete: true };
    if (length < 4) return { error: 'unexpected special packet in the command list' };
    if (offset + length > bytes.length) break;
    const line = commandLine(decoder.decode(bytes.subarray(offset + 4, offset + length)));
    offset += length;
    if (line.startsWith('shallow ')) continue;
    if (line.startsWith('push-cert')) return { error: 'signed pushes are not supported' };
    const [oldSha, newSha, ref, ...extra] = line.split(' ');
    if (oldSha === undefined || newSha === undefined || ref === undefined || extra.length > 0) {
      return { error: 'malformed push command' };
    }
    commands.push({ oldSha, newSha, ref });
  }
  return { commands, complete: false };
}

/** A command line without its capability list (after NUL) and trailing newline. */
function commandLine(payload: string): string {
  const nul = payload.indexOf('\0');
  const line = nul >= 0 ? payload.slice(0, nul) : payload;
  return line.endsWith('\n') ? line.slice(0, -1) : line;
}

function replay(
  head: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (head.length > 0) controller.enqueue(head);
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) controller.close();
      else controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

async function refuse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason: string,
): Promise<PushInspection> {
  await reader.cancel(reason);
  return { ok: false, reason };
}

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  const joined = new Uint8Array(left.length + right.length);
  joined.set(left, 0);
  joined.set(right, left.length);
  return joined;
}
