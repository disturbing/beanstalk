import { BeanDigest, BeanDiscoverPage, EXCERPT_CHARS } from '@gitstalk/shared-race/collaboration';
import type { BeanDiscoverInput } from '@gitstalk/shared-race/collaboration';
import type { RpcResult } from '@gitstalk/shared-race/rpc';

import { failure, readBean } from './store';

type Discovery = { sql: SqlStorage; own: string; limit: number; candidates: Set<string> };

/** Direct dependencies, indexed paths and lexical metadata surface work before code exists. */
export function discoverBeans(
  sql: SqlStorage,
  input: BeanDiscoverInput,
): RpcResult<BeanDiscoverPage> {
  const own = readBean(sql, input.bean);
  if (own === null) return failure('not_found', 404, 'bean does not exist');
  const discovery: Discovery = {
    sql,
    own: input.bean,
    limit: input.limit ?? 16,
    candidates: new Set(),
  };
  discoverDependencies(discovery);
  const paths = input.paths ?? own.approach?.paths ?? [];
  for (const path of paths.slice(0, 16)) discoverPath(discovery, path);
  discoverWords(discovery, input.query ?? `${own.intent} ${own.approach?.summary ?? ''}`);
  const ids = [...discovery.candidates].slice(0, discovery.limit);
  const truncated = discovery.candidates.size > discovery.limit || paths.length > 16;
  const page = { beans: readDigests(sql, ids), truncated };
  if (input.full !== true) return { ok: true, value: BeanDiscoverPage.parse(page) };
  const records = ids.map((bean) => {
    const record = readBean(sql, bean);
    if (record === null) throw new Error('discovered bean is missing');
    return record;
  });
  return { ok: true, value: BeanDiscoverPage.parse({ ...page, records }) };
}

/** One query reads only excerpts, so a 100 KB intent never leaves SQLite. */
function readDigests(sql: SqlStorage, ids: readonly string[]): BeanDigest[] {
  if (ids.length === 0) return [];
  const rows = sql
    .exec<{
      bean: string;
      revision: number;
      updated_at: string | null;
      intent: string;
      intent_length: number;
      paths: string | null;
    }>(
      `SELECT bean, json_extract(body, '$.revision') AS revision,
    json_extract(body, '$.updated_at') AS updated_at,
    substr(json_extract(body, '$.intent'), 1, ${EXCERPT_CHARS}) AS intent,
    length(json_extract(body, '$.intent')) AS intent_length,
    json_extract(body, '$.approach.paths') AS paths
    FROM collaboration_beans WHERE bean IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    )
    .toArray();
  const byBean = new Map(rows.map((row) => [row.bean, row]));
  return ids.flatMap((bean) => {
    const row = byBean.get(bean);
    if (row === undefined) throw new Error('discovered bean is missing');
    return BeanDigest.parse({
      bean,
      revision: row.revision,
      updated_at: row.updated_at,
      intent: row.intent,
      intent_truncated: row.intent_length > EXCERPT_CHARS,
      paths: row.paths === null ? [] : JSON.parse(row.paths),
    });
  });
}

function discoverDependencies(discovery: Discovery): void {
  const rows = discovery.sql
    .exec<{ bean: string }>(
      `SELECT bean FROM collaboration_reliance WHERE owner = ?
    UNION SELECT owner AS bean FROM collaboration_reliance WHERE bean = ?
    ORDER BY bean LIMIT ?`,
      discovery.own,
      discovery.own,
      discovery.limit + 2,
    )
    .toArray();
  addCandidates(discovery, rows);
}

function discoverPath(discovery: Discovery, path: string): void {
  if (discovery.candidates.size > discovery.limit) return;
  const descendants = discovery.sql
    .exec<{ bean: string }>(
      `SELECT DISTINCT bean FROM collaboration_paths
    WHERE path >= ? AND path < ? AND bean != ? ORDER BY bean LIMIT ?`,
      `${path}/`,
      `${path}0`,
      discovery.own,
      discovery.limit + 1,
    )
    .toArray();
  addCandidates(discovery, descendants);
  const segments = path.split('/');
  const ancestors = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
  for (let index = 0; index < ancestors.length; index += 50) {
    if (discovery.candidates.size > discovery.limit) return;
    const chunk = ancestors.slice(index, index + 50);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = discovery.sql
      .exec<{ bean: string }>(
        `SELECT DISTINCT bean FROM collaboration_paths
      WHERE path IN (${placeholders}) AND bean != ? ORDER BY bean LIMIT ?`,
        ...chunk,
        discovery.own,
        discovery.limit + 1,
      )
      .toArray();
    addCandidates(discovery, rows);
  }
}

function discoverWords(discovery: Discovery, query: string): void {
  if (discovery.candidates.size > discovery.limit) return;
  const tokens = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]{2,64}/gu) ?? [])]
    .filter((term) => !COMMON_WORDS.has(term))
    .slice(0, 8);
  if (tokens.length === 0) return;
  const match = tokens.map((term) => `"${term}"`).join(' OR ');
  const rows = discovery.sql
    .exec<{ bean: string }>(
      `SELECT bean FROM collaboration_search
    WHERE collaboration_search MATCH ? AND bean != ? ORDER BY rank, bean LIMIT ?`,
      match,
      discovery.own,
      discovery.limit + 1,
    )
    .toArray();
  addCandidates(discovery, rows);
}

function addCandidates(discovery: Discovery, rows: readonly { bean: string }[]): void {
  for (const row of rows) {
    if (row.bean !== discovery.own) discovery.candidates.add(row.bean);
    if (discovery.candidates.size > discovery.limit) return;
  }
}

const COMMON_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'from',
  'into',
  'implement',
  'add',
  'use',
  'change',
]);
