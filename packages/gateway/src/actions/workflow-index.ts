/**
 * The workflow index (doc 25 §0.2: git holds the definitions, the database is only an index):
 * the stalk's `.github/workflows/*.yml` read at a commit, parsed, and written to D1
 * (`actions_workflows`) in place of what the previous stalk had.
 */
import type { WorkflowSummary } from '@beanstalk/shared-race/actions';
import { WorkflowPath } from '@beanstalk/shared-race/actions';
import { z } from 'zod';

import type { RepoExplorer } from '../adapters/repo-explorer';
import { GatewayError } from '../errors';
import type { WorkflowFile } from './workflow-file';
import { readWorkflowFile } from './workflow-file';

export const WORKFLOWS_DIR = '.github/workflows';
/** Workflow files read per stalk move at most. */
const MAX_WORKFLOWS = 50;

export type IndexedWorkflow = {
  readonly summary: WorkflowSummary;
  readonly file: WorkflowFile;
  readonly source: string;
};

/** The workflow files at `sha`, parsed. A commit with no workflows directory has none. */
export async function readWorkflows(
  explorer: RepoExplorer,
  sha: string,
  limits: { readonly maxMatrixLegs: number },
): Promise<IndexedWorkflow[]> {
  const listing = await explorer.tree(sha, WORKFLOWS_DIR).catch((error: unknown) => {
    if (error instanceof GatewayError && error.status === 404) return null;
    throw error;
  });
  if (listing === null) return [];
  const paths = listing.entries
    .filter((entry) => entry.type === 'blob' && WorkflowPath.safeParse(entry.path).success)
    .map((entry) => entry.path)
    .slice(0, MAX_WORKFLOWS);
  const texts = await explorer.readTexts(sha, paths);
  const indexedAt = new Date().toISOString();
  const read = paths.map(async (path, index) => {
    const source = texts[index];
    if (source === null || source === undefined) return null;
    const file = await readWorkflowFile(path, source, limits);
    return { summary: summaryOf(file, { sha, indexedAt }), file, source };
  });
  return (await Promise.all(read)).filter((workflow) => workflow !== null);
}

/** Replaces the repository's index with `workflows` (read at the new stalk head). */
export async function writeIndex(
  db: D1Database,
  repoId: string,
  workflows: readonly IndexedWorkflow[],
): Promise<void> {
  const upserts = workflows.map((workflow) =>
    db
      .prepare(
        `INSERT INTO actions_workflows (repo_id, path, name, state, sha, summary_json, source, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(repo_id, path) DO UPDATE SET name = excluded.name, state = excluded.state,
           sha = excluded.sha, summary_json = excluded.summary_json, source = excluded.source,
           indexed_at = excluded.indexed_at`,
      )
      .bind(
        repoId,
        workflow.summary.path,
        workflow.summary.name,
        workflow.summary.state,
        workflow.summary.sha,
        JSON.stringify(workflow.summary),
        workflow.source,
        workflow.summary.indexedAt,
      ),
  );
  const kept = workflows.map((workflow) => workflow.summary.path);
  const removal = db
    .prepare(
      `DELETE FROM actions_workflows WHERE repo_id = ?${kept.length === 0 ? '' : ` AND path NOT IN (${kept.map(() => '?').join(', ')})`}`,
    )
    .bind(repoId, ...kept);
  await db.batch([...upserts, removal]);
}

const SummaryRow = z.object({ summary_json: z.string() });
const SourceRow = z.object({ source: z.string(), sha: z.string() });

/** The indexed workflows of a repository, by path. */
export async function listIndexed(db: D1Database, repoId: string): Promise<WorkflowSummary[]> {
  const { results } = await db
    .prepare('SELECT summary_json FROM actions_workflows WHERE repo_id = ? ORDER BY path')
    .bind(repoId)
    .all();
  // Written by `writeIndex` from a typed summary.
  return results.map((row): WorkflowSummary => JSON.parse(SummaryRow.parse(row).summary_json));
}

/** One indexed workflow's file and the stalk commit it was read at. */
export async function indexedSource(
  db: D1Database,
  repoId: string,
  path: string,
): Promise<{ readonly source: string; readonly sha: string } | null> {
  const row = await db
    .prepare('SELECT source, sha FROM actions_workflows WHERE repo_id = ? AND path = ?')
    .bind(repoId, path)
    .first();
  const parsed = SourceRow.safeParse(row);
  return parsed.success ? parsed.data : null;
}

function summaryOf(
  file: WorkflowFile,
  at: { readonly sha: string; readonly indexedAt: string },
): WorkflowSummary {
  return {
    path: WorkflowPath.parse(file.path),
    name: file.name,
    state: file.problems.length === 0 ? 'active' : 'invalid',
    triggers: file.triggers,
    unsupportedEvents: file.unsupportedEvents,
    jobs: file.jobs.map((job) => ({ key: job.key, name: job.nameTemplate ?? job.key, needs: job.needs })),
    problems: file.problems,
    compatibility: file.compatibility,
    sha: at.sha,
    indexedAt: at.indexedAt,
  };
}
