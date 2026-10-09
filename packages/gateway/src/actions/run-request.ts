/**
 * What the repository's ActionsRepoDO hands a new run's ActionsRunDO: everything the run needs
 * to plan its jobs, without reading the repository again.
 */
import type { ActionsEvent, ActionsRunId } from '@beanstalk/shared-race/actions';

import type { RepoFacts } from './event-payload';
import type { RunOrigin } from './secrets';

export type RunRequest = {
  readonly runId: ActionsRunId;
  readonly number: number;
  readonly repo: RepoFacts;
  readonly workflow: { readonly path: string; readonly source: string };
  readonly event: ActionsEvent;
  readonly eventPayload: Readonly<Record<string, unknown>>;
  readonly sha: string;
  readonly actor: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly origin: RunOrigin;
  /** An automation's model and spend cap (doc 25 §7.5); absent for a GitHub workflow. */
  readonly automation?: { readonly model: string | null; readonly maxCostUsd: number } | undefined;
  /** Set when the run must not start (the month's minutes are spent): its reason. */
  readonly refused: string | null;
  readonly createdMs: number;
};
