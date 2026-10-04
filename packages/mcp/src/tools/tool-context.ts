/**
 * What every tool reads with: the run the caller's token names, the forge over the gateway,
 * and the run's reduced event log, loaded at most once per MCP request.
 */
import type { RunId, TaskId } from '@beanstalk/shared-race/ids';
import type { GatewayRpc } from '@beanstalk/shared-race/rpc';
import { TaskId as TaskIdSchema } from '@beanstalk/shared-race/ids';

import type { Classifier } from '@beanstalk/shared-ask/ask/classifier';
import type { Picker } from '@beanstalk/shared-ask/pick/picker';
import { allEvents } from '@beanstalk/shared-ask/ask/plan-context';
import type { ForgeSource } from '@beanstalk/shared-ask/forge/forge-source';
import type { RaceEvent } from '@beanstalk/shared-ask/race/race-events';
import type { RaceState } from '@beanstalk/shared-ask/race/race-state';
import { reduceRace } from '@beanstalk/shared-ask/race/reduce-race';

export type RunSnapshot = {
  readonly events: readonly RaceEvent[];
  readonly state: RaceState;
};

export type ToolContext = {
  readonly run: RunId;
  /** The gateway's RPC, for what the forge adapter does not carry (the run view's window). */
  readonly gateway: GatewayRpc;
  readonly source: ForgeSource;
  readonly classifier: Classifier;
  /** Orders what an answer shows, as the web app does (`docs/claude-opus/14` §5). */
  readonly picker: Picker;
  /** The web app's origin, for `preview_url`. */
  readonly webUrl: string;
  snapshot(): Promise<RunSnapshot>;
};

/** A tool context whose snapshot is read once, on first use. */
export function toolContext(input: Omit<ToolContext, 'snapshot'>): ToolContext {
  let loaded: Promise<RunSnapshot> | undefined;
  return {
    ...input,
    snapshot: () => {
      loaded ??= loadSnapshot(input.source, input.run);
      return loaded;
    },
  };
}

async function loadSnapshot(source: ForgeSource, run: RunId): Promise<RunSnapshot> {
  const [events, options] = await Promise.all([allEvents(source, run), source.runOptions(run)]);
  return { events, state: reduceRace(events, options) };
}

/** A bean id from `t032` or `beans/t032`; undefined when it is neither. */
export function parseBean(value: string): TaskId | undefined {
  const parsed = TaskIdSchema.safeParse(value.trim().replace(/^beans\//, ''));
  return parsed.success ? parsed.data : undefined;
}

/** The bean's branch, the handle agents and git use. */
export function branchOf(bean: TaskId): string {
  return `beans/${bean}`;
}

/** Text cut to `max` characters, marked when cut. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Whole seconds, for race clocks in answers. */
export function seconds(t: number | null): number | null {
  return t === null ? null : Math.round(t);
}
