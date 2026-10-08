/**
 * ANSI colour in job logs: SGR sequences (`ESC[…m`) become styled runs of text; every other
 * escape (cursor moves, line clears, OSC titles and links) is dropped. The 16 named colours
 * map to theme tokens, so a log reads in night and day; 256-colour and true-colour values
 * stay as given. Text is never interpreted as HTML: the runs render as React text.
 */

export const NAMED_COLOURS = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
] as const;

export type AnsiColour =
  | {
      readonly kind: 'named';
      readonly name: (typeof NAMED_COLOURS)[number];
      readonly bright: boolean;
    }
  | { readonly kind: 'rgb'; readonly css: string };

export type AnsiStyle = {
  readonly fg: AnsiColour | null;
  readonly bg: AnsiColour | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
};

export type AnsiRun = { readonly text: string; readonly style: AnsiStyle };

const PLAIN: AnsiStyle = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
};

// ESC [ params final-byte (CSI), or ESC ] … BEL/ST (OSC), or a lone two-byte escape.
const ESCAPES =
  // oxlint-disable-next-line no-control-regex -- matching terminal escapes is the point
  /\u001b\[([0-9;?]*)([@-~])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b[@-Z\\-_]/g;

/** The line as styled runs (adjacent text with the same style merged). */
export function parseAnsi(line: string): readonly AnsiRun[] {
  const runs: AnsiRun[] = [];
  let style = PLAIN;
  let last = 0;
  for (const match of line.matchAll(ESCAPES)) {
    pushText(runs, line.slice(last, match.index), style);
    last = match.index + match[0].length;
    if (match[2] === 'm') style = applySgr(style, match[1] ?? '');
  }
  pushText(runs, line.slice(last), style);
  return runs;
}

/** The line's text with every escape removed (for search and the raw download). */
export function stripAnsi(line: string): string {
  return line.replace(ESCAPES, '');
}

function pushText(runs: AnsiRun[], text: string, style: AnsiStyle): void {
  if (text === '') return;
  const previous = runs.at(-1);
  if (previous !== undefined && previous.style === style) {
    runs[runs.length - 1] = { text: previous.text + text, style };
    return;
  }
  runs.push({ text, style });
}

function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  const codes = params === '' ? [0] : params.split(';').map((code) => Number(code) || 0);
  let next = style;
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index] ?? 0;
    if (code === 38 || code === 48) {
      const [colour, used] = extendedColour(codes, index + 1);
      index += used;
      if (colour !== null) next = code === 38 ? { ...next, fg: colour } : { ...next, bg: colour };
    } else {
      next = applyCode(next, code);
    }
  }
  return next;
}

function applyCode(style: AnsiStyle, code: number): AnsiStyle {
  if (code === 0) return PLAIN;
  if (code === 1) return { ...style, bold: true };
  if (code === 2) return { ...style, dim: true };
  if (code === 3) return { ...style, italic: true };
  if (code === 4) return { ...style, underline: true };
  if (code === 22) return { ...style, bold: false, dim: false };
  if (code === 23) return { ...style, italic: false };
  if (code === 24) return { ...style, underline: false };
  if (code === 39) return { ...style, fg: null };
  if (code === 49) return { ...style, bg: null };
  if (code >= 30 && code <= 37) return { ...style, fg: named(code - 30, false) };
  if (code >= 90 && code <= 97) return { ...style, fg: named(code - 90, true) };
  if (code >= 40 && code <= 47) return { ...style, bg: named(code - 40, false) };
  if (code >= 100 && code <= 107) return { ...style, bg: named(code - 100, true) };
  return style;
}

/** `5;n` (256 colours) or `2;r;g;b`, and how many codes it used. */
function extendedColour(
  codes: readonly number[],
  at: number,
): readonly [AnsiColour | null, number] {
  const mode = codes[at];
  if (mode === 5) {
    const index = codes[at + 1] ?? 0;
    if (index < 8) return [named(index, false), 2];
    if (index < 16) return [named(index - 8, true), 2];
    return [{ kind: 'rgb', css: xterm256(index) }, 2];
  }
  if (mode === 2) {
    const [r, g, b] = [codes[at + 1] ?? 0, codes[at + 2] ?? 0, codes[at + 3] ?? 0].map((value) =>
      Math.min(255, Math.max(0, value)),
    );
    return [{ kind: 'rgb', css: `rgb(${r}, ${g}, ${b})` }, 4];
  }
  return [null, 0];
}

function named(index: number, bright: boolean): AnsiColour {
  return { kind: 'named', name: NAMED_COLOURS[index] ?? 'white', bright };
}

function cubeLevel(value: number): number {
  return value === 0 ? 0 : 55 + value * 40;
}

function xterm256(index: number): string {
  if (index >= 232) {
    const grey = 8 + (index - 232) * 10;
    return `rgb(${grey}, ${grey}, ${grey})`;
  }
  const cube = index - 16;
  return `rgb(${cubeLevel(Math.floor(cube / 36))}, ${cubeLevel(Math.floor(cube / 6) % 6)}, ${cubeLevel(cube % 6)})`;
}
