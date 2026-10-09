/**
 * A minimal-diff writer for YAML: given the original text and the `yaml` package's rendering
 * of the edited document, it copies only the changed key's lines from the rendering into the
 * original, at the deepest block mapping both share. Every other line keeps its bytes (flow
 * lists, spacing before comments, quoting), so a form edit is a one-field diff. When splicing
 * cannot be shown to give the same value, the full rendering is used instead.
 */
import { isMap, isNode, isScalar, parseDocument } from 'yaml';
import type { Document, Pair, YAMLMap } from 'yaml';

import type { FieldPath } from './automation-draft';

/** `original` with the field at `path` taken from `rendered` (the same document, edited). */
export function minimalEdit(original: string, rendered: string, path: FieldPath): string {
  const before = parseDocument(original);
  const after = parseDocument(rendered);
  if (before.errors.length > 0 || after.errors.length > 0) return rendered;
  for (let depth = path.length; depth >= 1; depth -= 1) {
    const spliced = spliceAt(
      { text: original, document: before },
      { text: rendered, document: after },
      { parent: path.slice(0, depth - 1), key: path[depth - 1] ?? '' },
    );
    if (spliced !== null) return sameValue(spliced, after) ? spliced : rendered;
  }
  return rendered;
}

type Side = { readonly text: string; readonly document: Document };

/** The splice of `key` inside the block mapping at `parent`, or null when either lacks one. */
function spliceAt(
  original: Side,
  rendered: Side,
  where: { readonly parent: FieldPath; readonly key: string },
): string | null {
  const from = blockMapAt(original.document, where.parent);
  const to = blockMapAt(rendered.document, where.parent);
  if (from === null || to === null) return null;
  const oldPair = pairOf(from, where.key);
  const newPair = pairOf(to, where.key);
  if (oldPair === null && newPair === null) return original.text;
  const indent = indentOf(original.text, from) - indentOf(rendered.text, to);
  const lines =
    newPair === null
      ? ''
      : reindent(sliceOf(rendered.text, linesOf(rendered.text, newPair)), indent);
  if (oldPair !== null) {
    const span = linesOf(original.text, oldPair);
    return `${original.text.slice(0, span.start)}${lines}${original.text.slice(span.end)}`;
  }
  const at = insertionPoint(original.text, from, to, where.key);
  const separator = at > 0 && !original.text.slice(0, at).endsWith('\n') ? '\n' : '';
  return `${original.text.slice(0, at)}${separator}${lines}${original.text.slice(at)}`;
}

function blockMapAt(document: Document, path: FieldPath): YAMLMap | null {
  const node = path.length === 0 ? document.contents : document.getIn(path, true);
  return isMap(node) && node.flow !== true ? node : null;
}

function pairOf(map: YAMLMap, key: string): Pair | null {
  return map.items.find((pair) => isScalar(pair.key) && String(pair.key.value) === key) ?? null;
}

/** Whole lines from the pair's key to the end of its value (and its same-line comment). */
function linesOf(text: string, pair: Pair): { readonly start: number; readonly end: number } {
  const keyStart = isNode(pair.key) ? (pair.key.range?.[0] ?? 0) : 0;
  const keyEnd = isNode(pair.key) ? (pair.key.range?.[2] ?? keyStart) : keyStart;
  const valueEnd = isNode(pair.value) ? (pair.value.range?.[2] ?? keyStart) : keyEnd;
  const start = text.lastIndexOf('\n', keyStart - 1) + 1;
  return { start, end: endOfLine(text, valueEnd) };
}

function endOfLine(text: string, offset: number): number {
  if (offset > 0 && text[offset - 1] === '\n') return offset;
  const newline = text.indexOf('\n', offset);
  return newline < 0 ? text.length : newline + 1;
}

function sliceOf(text: string, span: { readonly start: number; readonly end: number }): string {
  const lines = text.slice(span.start, span.end);
  return lines.endsWith('\n') ? lines : `${lines}\n`;
}

/** Where a new key goes: after the sibling before it in the rendering, else at the map's end. */
function insertionPoint(text: string, from: YAMLMap, to: YAMLMap, key: string): number {
  const index = to.items.findIndex((pair) => isScalar(pair.key) && String(pair.key.value) === key);
  for (let before = index - 1; before >= 0; before -= 1) {
    const sibling = to.items[before];
    const name = sibling !== undefined && isScalar(sibling.key) ? String(sibling.key.value) : null;
    const existing = name === null ? null : pairOf(from, name);
    if (existing !== null) return linesOf(text, existing).end;
  }
  const last = from.items.at(-1);
  return last === undefined ? text.length : linesOf(text, last).end;
}

/** The column of the map's keys (0 for the top level). */
function indentOf(text: string, map: YAMLMap): number {
  const first = map.items[0];
  const start = first !== undefined && isNode(first.key) ? (first.key.range?.[0] ?? 0) : 0;
  return start - (text.lastIndexOf('\n', start - 1) + 1);
}

function reindent(lines: string, by: number): string {
  if (by === 0) return lines;
  return lines
    .split('\n')
    .map((line) => {
      if (line === '') return line;
      if (by > 0) return `${' '.repeat(by)}${line}`;
      const strip = Math.min(-by, line.length - line.trimStart().length);
      return line.slice(strip);
    })
    .join('\n');
}

function sameValue(text: string, expected: Document): boolean {
  const document = parseDocument(text);
  return (
    document.errors.length === 0 &&
    JSON.stringify(document.toJS()) === JSON.stringify(expected.toJS())
  );
}
