/**
 * A discrete-event simulation of the RunDO shell, the runner and the driver around the
 * engine: it applies inputs to `step()` in time order exactly as the shell does, runs jobs
 * and agents against a scripted world, and returns the event log. Deterministic.
 */
import type { SlotId } from '@beanstalk/shared-race/ids';
import { slotIds } from '@beanstalk/shared-race/ids';
import type { RunConfigInput } from '@beanstalk/shared-race/run-config';
import { RunConfig } from '@beanstalk/shared-race/run-config';

import type { EngineEnv } from '../catalog';
import { engineEnv } from '../catalog';
import { step } from '../engine';
import { initialEngineState } from '../lifecycle';
import type { EmittedEvent, EngineInput, EngineReply } from '../model';
import type { EngineState } from '../state';
import type { World } from './fake-world';

/** A fixed epoch so event timestamps are reproducible. */
export const SIMULATION_EPOCH_MS = Date.UTC(2026, 9, 3, 12, 0, 0);
/** The shell's long-poll limit (§4). */
const POLL_EXPIRY_MS = 25_000;
/** Simulated hours after which a run that has not ended counts as stuck. */
const MAX_SIMULATED_MS = 24 * 3600 * 1000;
const MAX_STEPS = 200_000;

export type AgentTiming = (inv: string, task: string, kind: string, attempt: number) => number;

export type SimulationOptions = {
  readonly config: RunConfigInput;
  readonly world: World;
  /** Milliseconds each agent invocation takes; deterministic per invocation. */
  readonly agentMillis: AgentTiming;
  /** Slots whose driver never polls (a crashed or missing driver slot). */
  readonly silentSlots?: readonly SlotId[];
  /** When the admin starts the run, milliseconds after creation. */
  readonly startAfterMs?: number;
  /** Inputs to inject at given times (admin stop, progress reports …). */
  readonly injections?: readonly { at: number; input: (at: number) => EngineInput }[];
  /** Invocations whose result the driver never posts (it crashed mid-run, then re-polls). */
  readonly lostInvocations?: readonly string[];
};

export type SimulationResult = {
  readonly events: readonly EmittedEvent[];
  readonly state: EngineState;
  readonly env: EngineEnv;
  readonly refusals: readonly string[];
};

type Scheduled = { at: number; seq: number; run: () => void };

/** Runs a whole race and returns its events and final state. */
export function simulate(options: SimulationOptions): SimulationResult {
  const env = engineEnv(RunConfig.parse(options.config));
  const sim = createSimulation(env, options);
  sim.run();
  return { events: sim.events, state: sim.state(), env, refusals: sim.refusals };
}

function createSimulation(env: EngineEnv, options: SimulationOptions) {
  const queue: Scheduled[] = [];
  const events: EmittedEvent[] = [];
  const refusals: string[] = [];
  const pollOwners = new Map<string, SlotId>();
  const scheduledTicks = new Set<number>();
  const finishedSlots = new Set<SlotId>();
  const clock = { now: SIMULATION_EPOCH_MS, seq: 0, polls: 0, lastTick: 0 };
  let state = initialEngineState(env, SIMULATION_EPOCH_MS);

  const schedule = (at: number, run: () => void): void => {
    clock.seq += 1;
    queue.push({ at, seq: clock.seq, run });
  };

  const apply = (input: EngineInput): void => {
    const output = step(state, input, env);
    state = output.state;
    events.push(...output.effects.events);
    if (output.response.kind === 'refused') refusals.push(output.response.refusal.code);
    if (
      output.response.kind === 'poll' &&
      output.response.reply !== null &&
      input.kind === 'poll'
    ) {
      deliver(input.pollId, output.response.reply);
    }
    for (const job of output.effects.jobs) {
      schedule(clock.now + options.world.jobMillis(job.spec), () =>
        apply({
          kind: 'job-done',
          at: clock.now,
          jobId: job.id,
          outcome: options.world.runJob(job.spec),
        }),
      );
    }
    for (const { pollId, reply } of output.effects.replies) deliver(pollId, reply);
    scheduleNextTick();
  };

  const scheduleNextTick = (): void => {
    const next = Math.min(...Object.values(state.timers).map((timer) => timer.at));
    if (!Number.isFinite(next)) return;
    // A timer due at or before the last tick's millisecond (set during it, or not quite due by
    // float rounding) fires a millisecond later, as a Durable Object alarm set in the past does.
    const at = Math.max(Math.ceil(state.createdAtMs + next * 1000), clock.lastTick + 1);
    if (scheduledTicks.has(at)) return;
    scheduledTicks.add(at);
    schedule(Math.max(at, clock.now), () => {
      clock.lastTick = clock.now;
      apply({ kind: 'tick', at: clock.now });
    });
  };

  const deliver = (pollId: string, reply: EngineReply): void => {
    const slot = pollOwners.get(pollId);
    if (slot === undefined) return;
    pollOwners.delete(pollId);
    if ('invocation' in reply) {
      const instruction = reply.invocation;
      const millis = options.agentMillis(
        instruction.inv,
        instruction.task,
        instruction.kind,
        instruction.attempt,
      );
      schedule(clock.now + millis, () => {
        if (!(options.lostInvocations ?? []).includes(instruction.inv)) {
          const result = options.world.runAgent(instruction);
          apply({ kind: 'result', at: clock.now, slot, inv: instruction.inv, result });
        }
        poll(slot);
      });
      return;
    }
    if ('done' in reply) {
      finishedSlots.add(slot);
      return;
    }
    schedule(clock.now + 1, () => poll(slot));
  };

  const poll = (slot: SlotId): void => {
    clock.polls += 1;
    const pollId = `poll${clock.polls}`;
    pollOwners.set(pollId, slot);
    apply({ kind: 'poll', at: clock.now, slot, pollId });
    schedule(clock.now + POLL_EXPIRY_MS, () => {
      if (pollOwners.has(pollId)) apply({ kind: 'poll-expired', at: clock.now, slot, pollId });
    });
  };

  const silent = new Set(options.silentSlots ?? []);
  const activeSlots = slotIds(env.config.agents).filter((slot) => !silent.has(slot));

  return {
    events,
    refusals,
    state: () => state,
    run(): void {
      activeSlots.forEach((slot, index) =>
        schedule(SIMULATION_EPOCH_MS + 100 + index, () => poll(slot)),
      );
      schedule(SIMULATION_EPOCH_MS + (options.startAfterMs ?? 1000), () =>
        apply({
          kind: 'start',
          at: clock.now,
          baseSha: options.world.baseSha,
          labels: { out: 'sim', repo: 'race-sim' },
        }),
      );
      for (const injection of options.injections ?? []) {
        schedule(SIMULATION_EPOCH_MS + injection.at, () => apply(injection.input(clock.now)));
      }
      for (let steps = 0; steps < MAX_STEPS; steps += 1) {
        if (state.phase === 'done' && activeSlots.every((slot) => finishedSlots.has(slot))) return;
        queue.sort((a, b) => a.at - b.at || a.seq - b.seq);
        const next = queue.shift();
        if (next === undefined) throw new Error(`simulation stalled in phase ${state.phase}`);
        if (next.at - SIMULATION_EPOCH_MS > MAX_SIMULATED_MS)
          throw new Error('simulation ran past its time limit');
        clock.now = Math.max(clock.now, next.at);
        next.run();
      }
      throw new Error('simulation exceeded its step limit');
    },
  };
}

/** Agent durations drawn from the seed: a few seconds to a few minutes, as replay agents. */
export function seededAgentMillis(seed: number): AgentTiming {
  return (inv, task, kind, attempt) => {
    const hash = fnv1a(`${seed}:${task}:${kind}:${attempt}:${inv}`);
    const base = kind === 'initial' ? 20_000 : 10_000;
    return base + (hash % 40_000);
  };
}

function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
