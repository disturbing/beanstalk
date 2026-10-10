/**
 * `change_status`: where one bean stands after its author submitted it. Landed on the sprout
 * and awaiting validation, green on the stalk, sent back for rework, waiting on a decision,
 * reverted or dropped; with what to do next and the latest steps as evidence.
 */
import type { Sha, SlotId, TaskId } from '@gitstalk/shared-race/ids';

import type { BeanDetail, BeanStatus } from '@gitstalk/shared-ask/forge/forge-source';

import { previewUrl } from './preview-link';
import type { ToolContext } from './tool-context';
import { branchOf, clip, editingNow, seconds } from './tool-context';

const STEPS_SHOWN = 5;
const MESSAGE_CHARS = 300;

export type ChangeStatus = {
  readonly bean: TaskId;
  readonly branch: string;
  readonly title: string;
  readonly status: BeanStatus;
  readonly phase: string;
  readonly slot: SlotId | null;
  readonly head: Sha | null;
  readonly landed_idx: number | null;
  readonly checks: { readonly total: number; readonly red: number };
  readonly reworks: number;
  readonly conflicts: number;
  readonly card: string | null;
  readonly drop_reason: string | null;
  readonly last_message: string;
  readonly recent_steps: readonly {
    readonly at_s: number;
    readonly kind: string;
    readonly detail: string;
  }[];
  /**
   * `stream_diffs`: what its agent is editing right now, before the commit (the observed
   * footprint); null when nothing streams.
   */
  readonly editing_now: {
    readonly files: readonly { path: string; additions: number; deletions: number }[];
    readonly snapshot: number;
    readonly at_s: number;
  } | null;
  readonly next: string;
  readonly preview_url: string;
  readonly summary: string;
};

/** The bean's status, or undefined when the run has no such bean. */
export async function changeStatus(
  ctx: ToolContext,
  bean: TaskId,
): Promise<ChangeStatus | undefined> {
  const [detail, editing] = await Promise.all([
    ctx.source.beanDetail(ctx.run, bean),
    editingNow(ctx),
  ]);
  if (detail === undefined) return undefined;
  const stream = editing.get(bean);
  const next = nextStep(detail);
  return {
    bean,
    branch: branchOf(bean),
    title: detail.title,
    status: detail.status,
    phase: detail.phase,
    slot: detail.agent,
    head: detail.head,
    landed_idx: detail.landedIdx,
    checks: { total: detail.checks, red: detail.redChecks },
    reworks: detail.reworks,
    conflicts: detail.conflicts,
    card: detail.card,
    drop_reason: detail.dropReason,
    last_message: clip(detail.lastMessage, MESSAGE_CHARS),
    recent_steps: detail.steps.slice(-STEPS_SHOWN).map((step) => ({
      at_s: seconds(step.t) ?? 0,
      kind: step.kind,
      detail: step.detail,
    })),
    editing_now:
      stream === undefined
        ? null
        : {
            files: stream.files.map(({ path, additions, deletions }) => ({
              path,
              additions,
              deletions,
            })),
            snapshot: stream.seq,
            at_s: seconds(stream.t) ?? 0,
          },
    next,
    preview_url: previewUrl(ctx.webUrl, ctx.run, { kind: 'bean', bean }),
    summary: `${bean} ${detail.status} (${detail.phase}). ${next}`,
  };
}

function nextStep(detail: BeanDetail): string {
  if (detail.phase === 'rework') return 'Sent back: read checks_get, fix the code, resubmit.';
  if (detail.phase === 'deciding')
    return `Decision card ${detail.card ?? '(unnamed)'} is open; a person decides. Wait.`;
  switch (detail.status) {
    case 'pending':
      return 'Not started yet.';
    case 'in-flight':
      return 'In flight: poll change_status again.';
    case 'landed':
      return 'On the sprout, awaiting validation: poll again.';
    case 'green':
      return 'On the stalk. Done.';
    case 'reverted':
      return 'Reverted from the sprout: read checks_get.';
    case 'dropped':
      return `Dropped: ${detail.dropReason ?? 'no reason recorded'}.`;
    case 'parked':
      return 'Parked: it needs a person (see its last step). Stop working on it.';
    default:
      return assertNever(detail.status);
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected bean status ${String(value)}`);
}
