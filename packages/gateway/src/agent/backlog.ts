/**
 * A repository's backlog is a Markdown task list in the repository itself, read from the
 * sprout: `.gitstalk/backlog.md`, else the older `.beanstalk/backlog.md`, else `BACKLOG.md`. Changing the backlog is a bean like any
 * other change; who works on what (claims, beans in flight, landed) lives in the engine.
 *
 * ```markdown
 * - [ ] add-total: Add a total helper
 *   Sum the line items; keep it pure.
 * - [x] T-2: Rename the cart module
 * - [ ] Untagged tasks get an id from their title
 * ```
 *
 * A task is a list item with a checkbox. Its id is the word before the first `: ` (letters,
 * digits, `.`, `_`, `#`, `/`, `-`), else a slug of its title. Indented lines under it are its
 * detail. A ticked box is done whatever the engine says.
 */

import { configPaths } from '@gitstalk/shared-race/config-dir';

/** Where a backlog may live, in the order they are tried. */
export const BACKLOG_FILES: readonly string[] = [...configPaths('backlog.md'), 'BACKLOG.md'];

/** Tasks read from one file; more are ignored. */
export const MAX_TASKS = 200;
const MAX_DETAIL_CHARS = 1000;
const MAX_TITLE_CHARS = 200;

export type BacklogEntry = {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly isTicked: boolean;
};

const ITEM = /^(\s*)[-*+]\s+\[([ xX])\]\s+(.+?)\s*$/;
const TAGGED = /^\[?([A-Za-z0-9][A-Za-z0-9._#/-]{0,63})\]?:\s+(.+)$/;

/** The tasks of a backlog file, in file order, ids made unique. */
export function parseBacklog(markdown: string): readonly BacklogEntry[] {
  const entries: { id: string; title: string; detail: string[]; isTicked: boolean }[] = [];
  let current: (typeof entries)[number] | null = null;
  let indent = 0;
  for (const line of markdown.replaceAll('\r\n', '\n').split('\n')) {
    const item = ITEM.exec(line);
    if (item !== null) {
      if (entries.length >= MAX_TASKS) break;
      indent = item[1]?.length ?? 0;
      current = { ...titled(item[3] ?? ''), detail: [], isTicked: item[2] !== ' ' };
      entries.push(current);
    } else if (current !== null && isDetail(line, indent)) {
      current.detail.push(line.trim());
    } else if (line.trim() !== '') {
      current = null;
    }
  }
  return withUniqueIds(entries).map((entry) => ({
    id: entry.id,
    title: entry.title,
    detail: entry.detail.join('\n').trim().slice(0, MAX_DETAIL_CHARS),
    isTicked: entry.isTicked,
  }));
}

function titled(text: string): { id: string; title: string } {
  const tagged = TAGGED.exec(text);
  if (tagged?.[1] !== undefined && tagged[2] !== undefined)
    return { id: tagged[1], title: tagged[2].slice(0, MAX_TITLE_CHARS) };
  return { id: slug(text), title: text.slice(0, MAX_TITLE_CHARS) };
}

/** A line under an item that belongs to it: indented deeper, or blank. */
function isDetail(line: string, indent: number): boolean {
  if (line.trim() === '') return true;
  const leading = /^\s*/.exec(line)?.[0].length ?? 0;
  return leading > indent;
}

function slug(text: string): string {
  const words = text
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return (words.slice(0, 40).replace(/-+$/, '') || 'task').replace(/^[^a-z0-9]/, 't');
}

function withUniqueIds<T extends { id: string }>(entries: readonly T[]): T[] {
  const seen = new Map<string, number>();
  return entries.map((entry) => {
    const count = (seen.get(entry.id) ?? 0) + 1;
    seen.set(entry.id, count);
    return count === 1 ? entry : { ...entry, id: `${entry.id}-${count}` };
  });
}
