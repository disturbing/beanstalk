/**
 * Syntax highlighting for the Code tab, on the server and without a dependency: a small
 * tokenizer that knows comments, strings, numbers, keywords and types for the languages a
 * repository here usually holds. It never guesses beyond that; anything else is plain text,
 * so a wrong colour is the worst case, never wrong text. Tokens are split at line ends so the
 * file view keeps one table row per line.
 */

export type TokenKind =
  | 'plain'
  | 'comment'
  | 'string'
  | 'regex'
  | 'number'
  | 'keyword'
  | 'type'
  | 'key';

export type Token = { readonly kind: TokenKind; readonly text: string };

/** A file's lines, each a list of tokens whose texts join to the line. */
export type HighlightedLines = readonly (readonly Token[])[];

type Grammar = {
  /** Comment openers: a line comment runs to the line end; a block comment to its closer. */
  readonly line: readonly string[];
  readonly block: readonly (readonly [string, string])[];
  readonly quotes: readonly string[];
  readonly keywords: ReadonlySet<string>;
  /** Capitalised words are types (TypeScript, Rust, Go …). */
  readonly capitalTypes: boolean;
  /** `name =` or `"name":` at a line start reads as a key (TOML, JSON, YAML). */
  readonly keys: boolean;
  /** `/…/flags` where an expression may start is a regular expression (JavaScript). */
  readonly regex?: boolean;
};

const C_LIKE = { line: ['//'], block: [['/*', '*/']] } as const;

const TS_KEYWORDS = words(
  'as async await break case catch class const continue default delete do else enum export extends false finally for from function if implements import in instanceof interface let new null of private protected public readonly return satisfies static super switch this throw true try type typeof undefined var void while yield',
);

const GRAMMARS: Readonly<Record<string, Grammar>> = {
  ts: {
    ...C_LIKE,
    quotes: ['"', "'", '`'],
    keywords: TS_KEYWORDS,
    capitalTypes: true,
    keys: false,
    regex: true,
  },
  rust: {
    ...C_LIKE,
    quotes: ['"'],
    keywords: words(
      'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    ),
    capitalTypes: true,
    keys: false,
  },
  go: {
    ...C_LIKE,
    quotes: ['"', '`'],
    keywords: words(
      'break case chan const continue default defer else fallthrough for func go goto if import interface map nil package range return select struct switch type var true false',
    ),
    capitalTypes: true,
    keys: false,
  },
  css: {
    line: [],
    block: [['/*', '*/']],
    quotes: ['"', "'"],
    keywords: words('important media supports import from to'),
    capitalTypes: false,
    keys: false,
  },
  python: {
    line: ['#'],
    block: [],
    quotes: ['"', "'"],
    keywords: words(
      'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
    ),
    capitalTypes: true,
    keys: false,
  },
  shell: {
    line: ['#'],
    block: [],
    quotes: ['"', "'"],
    keywords: words(
      'case do done elif else esac export fi for function if in local return set then until while',
    ),
    capitalTypes: false,
    keys: false,
  },
  toml: {
    line: ['#'],
    block: [],
    quotes: ['"', "'"],
    keywords: words('true false'),
    capitalTypes: false,
    keys: true,
  },
  json: {
    line: [],
    block: [],
    quotes: ['"'],
    keywords: words('true false null'),
    capitalTypes: false,
    keys: true,
  },
  yaml: {
    line: ['#'],
    block: [],
    quotes: ['"', "'"],
    keywords: words('true false null yes no'),
    capitalTypes: false,
    keys: true,
  },
};

const EXTENSIONS: Readonly<Record<string, keyof typeof GRAMMARS>> = {
  ts: 'ts',
  tsx: 'ts',
  mts: 'ts',
  cts: 'ts',
  js: 'ts',
  jsx: 'ts',
  mjs: 'ts',
  cjs: 'ts',
  rs: 'rust',
  go: 'go',
  css: 'css',
  scss: 'css',
  py: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  toml: 'toml',
  json: 'json',
  jsonc: 'ts',
  yml: 'yaml',
  yaml: 'yaml',
};

/** The grammar's name for a path, or null for files shown as plain text. */
export function languageOf(path: string): string | null {
  const name = path.split('/').at(-1) ?? path;
  if (name === 'Dockerfile' || name === 'Makefile') return 'shell';
  const extension = name.includes('.') ? (name.split('.').at(-1) ?? '').toLowerCase() : '';
  return EXTENSIONS[extension] ?? null;
}

/** `text` as highlighted lines (plain lines for a language it does not know). */
export function highlight(text: string, language: string | null): HighlightedLines {
  const grammar = language === null ? undefined : GRAMMARS[language];
  const tokens: readonly Token[] =
    grammar === undefined ? [{ kind: 'plain', text }] : tokenize(text, grammar);
  return splitLines(tokens);
}

function tokenize(text: string, grammar: Grammar): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  let plain = '';
  const flush = (): void => {
    if (plain !== '') tokens.push({ kind: 'plain', text: plain });
    plain = '';
  };
  while (index < text.length) {
    const found = nextToken(text, index, grammar, plain);
    if (found === null) {
      plain += text[index] ?? '';
      index += 1;
      continue;
    }
    flush();
    tokens.push(found);
    index += found.text.length;
  }
  flush();
  return tokens;
}

/** The token starting at `index`, or null when the character is plain. */
function nextToken(text: string, index: number, grammar: Grammar, before: string): Token | null {
  const rest = text.slice(index, index + 3);
  const line = grammar.line.find((opener) => rest.startsWith(opener));
  if (line !== undefined) return { kind: 'comment', text: untilLineEnd(text, index) };
  const block = grammar.block.find(([opener]) => rest.startsWith(opener));
  if (block !== undefined)
    return { kind: 'comment', text: until(text, index, block[1], block[0].length) };
  if (grammar.regex === true && text[index] === '/' && startsExpression(text, index)) {
    const literal = regexAt(text, index);
    if (literal !== null) return { kind: 'regex', text: literal };
  }
  const quote = grammar.quotes.find((mark) => text[index] === mark);
  if (quote !== undefined) {
    const literal = stringAt(text, index, quote);
    return {
      kind: grammar.keys && isKeyString(text, index + literal.length) ? 'key' : 'string',
      text: literal,
    };
  }
  const char = text[index] ?? '';
  const previous = before.at(-1) ?? text[index - 1] ?? '';
  if (/[A-Za-z_$]/.test(previous) || /[0-9]/.test(previous)) return null;
  const number = /^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)/.exec(
    text.slice(index, index + 40),
  );
  if (number !== null && /[0-9]/.test(char)) return { kind: 'number', text: number[0] };
  const word = /^[A-Za-z_$][\w$]*/.exec(text.slice(index, index + 80));
  if (word === null) return null;
  return { kind: wordKind(word[0], text, index, grammar), text: word[0] };
}

function wordKind(word: string, text: string, index: number, grammar: Grammar): TokenKind {
  if (grammar.keys && isBareKey(text, index, word)) return 'key';
  if (grammar.keywords.has(word)) return 'keyword';
  if (grammar.capitalTypes && /^[A-Z][a-z0-9]/.test(word)) return 'type';
  return 'plain';
}

/** A bare `name =` or `name:` at the start of its line (TOML, YAML). */
function isBareKey(text: string, index: number, word: string): boolean {
  const lineStart = text.lastIndexOf('\n', index - 1) + 1;
  if (text.slice(lineStart, index).trim() !== '') return false;
  return /^\s*[=:]/.test(text.slice(index + word.length, index + word.length + 4));
}

/** A quoted key: the string is followed by `:` (JSON) or `=` (TOML). */
function isKeyString(text: string, after: number): boolean {
  return /^\s*[:=]/.test(text.slice(after, after + 4));
}

/** Whether an expression may start at `index`: after an operator, an opening bracket or `return`. */
function startsExpression(text: string, index: number): boolean {
  const before = text.slice(Math.max(0, index - 40), index).trimEnd();
  if (before === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(before)) return true;
  return /\b(return|typeof|case|in|of|yield|await)$/.test(before);
}

/** A regular-expression literal on one line (brackets may hold `/`), with its flags; or null. */
function regexAt(text: string, index: number): string | null {
  let end = index + 1;
  let inClass = false;
  while (end < text.length) {
    const char = text[end];
    if (char === '\n') return null;
    if (char === '\\') end += 1;
    else if (char === '[') inClass = true;
    else if (char === ']') inClass = false;
    else if (char === '/' && !inClass) {
      const flags = /^[a-z]*/.exec(text.slice(end + 1, end + 10))?.[0] ?? '';
      return text.slice(index, end + 1 + flags.length);
    }
    end += 1;
  }
  return null;
}

function stringAt(text: string, index: number, quote: string): string {
  let end = index + 1;
  while (end < text.length) {
    const char = text[end];
    if (char === '\\') end += 2;
    else if (char === quote) return text.slice(index, end + 1);
    else if (char === '\n' && quote !== '`') return text.slice(index, end);
    else end += 1;
  }
  return text.slice(index);
}

function untilLineEnd(text: string, index: number): string {
  const end = text.indexOf('\n', index);
  return end === -1 ? text.slice(index) : text.slice(index, end);
}

function until(text: string, index: number, closer: string, skip: number): string {
  const end = text.indexOf(closer, index + skip);
  return end === -1 ? text.slice(index) : text.slice(index, end + closer.length);
}

function splitLines(tokens: readonly Token[]): HighlightedLines {
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, partIndex) => {
      if (partIndex > 0) lines.push([]);
      if (part !== '') lines.at(-1)?.push({ kind: token.kind, text: part });
    });
  }
  // A file ending in a newline has no empty last line to show.
  if (lines.length > 1 && lines.at(-1)?.length === 0) lines.pop();
  return lines;
}

function words(list: string): ReadonlySet<string> {
  return new Set(list.split(' '));
}
