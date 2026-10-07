/**
 * The README on the Code tab: Markdown parsed into blocks and inline runs that the page
 * renders as React elements, never as HTML. Raw HTML in the file is shown as text, and only
 * http(s), mailto and relative links become links, so a README cannot run script or style
 * the page. It covers what READMEs use: headings, paragraphs, lists, quotes, fenced code and
 * rules; tables stay as text.
 */

export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'strong'; readonly children: readonly Inline[] }
  | { readonly kind: 'em'; readonly children: readonly Inline[] }
  | { readonly kind: 'link'; readonly href: string; readonly children: readonly Inline[] };

export type Block =
  | { readonly kind: 'heading'; readonly level: 1 | 2 | 3 | 4; readonly inline: readonly Inline[] }
  | { readonly kind: 'paragraph'; readonly inline: readonly Inline[] }
  | {
      readonly kind: 'list';
      readonly ordered: boolean;
      readonly items: readonly (readonly Inline[])[];
    }
  | { readonly kind: 'quote'; readonly inline: readonly Inline[] }
  | { readonly kind: 'code'; readonly language: string; readonly text: string }
  | { readonly kind: 'rule' };

const FENCE = /^(```|~~~)\s*([\w+-]*)/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;

export function parseMarkdown(source: string): readonly Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const read = readBlock(lines, index);
    if (read.block !== null) blocks.push(read.block);
    index = read.next;
  }
  return blocks;
}

type Read = { readonly block: Block | null; readonly next: number };

function readBlock(lines: readonly string[], index: number): Read {
  const line = lines[index] ?? '';
  if (line.trim() === '') return { block: null, next: index + 1 };
  const fence = FENCE.exec(line);
  if (fence !== null) return readFence(lines, index, fence[1] ?? '```', fence[2] ?? '');
  const heading = HEADING.exec(line);
  if (heading !== null) {
    const level = headingLevel(heading[1]?.length ?? 1);
    return {
      block: { kind: 'heading', level, inline: parseInline(heading[2] ?? '') },
      next: index + 1,
    };
  }
  if (RULE.test(line)) return { block: { kind: 'rule' }, next: index + 1 };
  if (BULLET.test(line) || NUMBERED.test(line)) return readList(lines, index);
  if (line.startsWith('>')) return readQuote(lines, index);
  return readParagraph(lines, index);
}

function headingLevel(hashes: number): 1 | 2 | 3 | 4 {
  if (hashes <= 1) return 1;
  if (hashes === 2) return 2;
  return hashes === 3 ? 3 : 4;
}

function readFence(
  lines: readonly string[],
  index: number,
  marker: string,
  language: string,
): Read {
  const body: string[] = [];
  let next = index + 1;
  while (next < lines.length && !(lines[next] ?? '').startsWith(marker)) {
    body.push(lines[next] ?? '');
    next += 1;
  }
  return { block: { kind: 'code', language, text: body.join('\n') }, next: next + 1 };
}

function readList(lines: readonly string[], index: number): Read {
  const ordered = NUMBERED.test(lines[index] ?? '') && !BULLET.test(lines[index] ?? '');
  const pattern = ordered ? NUMBERED : BULLET;
  const items: string[] = [];
  let next = index;
  while (next < lines.length) {
    const line = lines[next] ?? '';
    const item = pattern.exec(line);
    if (item !== null) items.push(item[1] ?? '');
    else if (line.trim() !== '' && /^\s{2,}/.test(line) && items.length > 0)
      items[items.length - 1] = `${items.at(-1) ?? ''} ${line.trim()}`;
    else break;
    next += 1;
  }
  return { block: { kind: 'list', ordered, items: items.map(parseInline) }, next };
}

function readQuote(lines: readonly string[], index: number): Read {
  const body: string[] = [];
  let next = index;
  while (next < lines.length && (lines[next] ?? '').startsWith('>')) {
    body.push((lines[next] ?? '').replace(/^>\s?/, ''));
    next += 1;
  }
  return { block: { kind: 'quote', inline: parseInline(body.join(' ')) }, next };
}

function readParagraph(lines: readonly string[], index: number): Read {
  const body: string[] = [];
  let next = index;
  while (next < lines.length) {
    const line = lines[next] ?? '';
    if (
      line.trim() === '' ||
      FENCE.test(line) ||
      HEADING.test(line) ||
      BULLET.test(line) ||
      line.startsWith('>')
    )
      break;
    body.push(line.trim());
    next += 1;
  }
  return { block: { kind: 'paragraph', inline: parseInline(body.join(' ')) }, next };
}

/** Code spans, links, then strong and emphasis, in that order of precedence. */
export function parseInline(text: string): readonly Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest !== '') {
    const match = firstMatch(rest);
    if (match === null) {
      pushText(out, rest);
      break;
    }
    pushText(out, rest.slice(0, match.index));
    out.push(match.inline);
    rest = rest.slice(match.index + match.length);
  }
  return out;
}

type Match = { readonly index: number; readonly length: number; readonly inline: Inline };

const INLINE: readonly {
  readonly pattern: RegExp;
  readonly make: (found: RegExpExecArray) => Inline;
}[] = [
  { pattern: /`([^`]+)`/, make: (found) => ({ kind: 'code', text: found[1] ?? '' }) },
  {
    pattern: /\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/,
    make: (found) => linkOrText(found[1] ?? '', found[2] ?? ''),
  },
  {
    pattern: /(\*\*|__)(.+?)\1/,
    make: (found) => ({ kind: 'strong', children: parseInline(found[2] ?? '') }),
  },
  {
    pattern: /(?<![\w*])([*_])(?!\s)(.+?)(?<!\s)\1(?![\w*])/,
    make: (found) => ({ kind: 'em', children: parseInline(found[2] ?? '') }),
  },
];

function firstMatch(text: string): Match | null {
  let best: Match | null = null;
  for (const rule of INLINE) {
    const found = rule.pattern.exec(text);
    if (found !== null && (best === null || found.index < best.index))
      best = { index: found.index, length: found[0].length, inline: rule.make(found) };
  }
  return best;
}

/** A link only for a safe target; anything else keeps its words as text. */
function linkOrText(label: string, href: string): Inline {
  const children = parseInline(label);
  if (!isSafeHref(href)) return { kind: 'strong', children };
  return { kind: 'link', href, children };
}

export function isSafeHref(href: string): boolean {
  if (/^(https?:|mailto:)/i.test(href)) return true;
  // Relative: no scheme at all (javascript:, data: and the like have one).
  return !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//');
}

function pushText(out: Inline[], text: string): void {
  if (text !== '') out.push({ kind: 'text', text });
}
