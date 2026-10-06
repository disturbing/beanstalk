import { BeanDiscoverPage } from '@beanstalk/shared-race/collaboration';
import type { BeanDiscoverInput } from '@beanstalk/shared-race/collaboration';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

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
  const beans = [...discovery.candidates].slice(0, discovery.limit).map((bean) => {
    const record = readBean(sql, bean);
    if (record === null) throw new Error('discovered bean is missing');
    return record;
  });
  return {
    ok: true,
    value: BeanDiscoverPage.parse({
      beans,
      truncated: discovery.candidates.size > discovery.limit || paths.length > 16,
    }),
  };
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
