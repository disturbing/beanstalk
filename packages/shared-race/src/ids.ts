import { z } from 'zod';

/**
 * A run id: the RunDO name and the stem of every Artifacts repo name of the run (the run
 * repo `race-<run>` and each bean `race-<run>-<task>`), so it stays short and lower case.
 */
export const RunId = z
  .string()
  .regex(/^[a-z0-9]{6,24}$/)
  .brand<'RunId'>();
export type RunId = z.infer<typeof RunId>;

/**
 * An arena task id (`t001`). It becomes part of a repo name and a branch name, so it is
 * limited to the characters both allow and to a length that keeps repo names under 63.
 */
export const TaskId = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/)
  .refine((id) => !id.endsWith('.lock') && !id.includes('..'), 'not usable in a git ref')
  .brand<'TaskId'>();
export type TaskId = z.infer<typeof TaskId>;

/** A full, lower-case SHA-1 commit id. */
export const Sha = z
  .string()
  .regex(/^[0-9a-f]{40}$/)
  .brand<'Sha'>();
export type Sha = z.infer<typeof Sha>;

/** An agent slot (`a0` … `a63`): one concurrent agent session of the driver. */
export type SlotId = `a${number}`;

export const SlotId = z
  .string()
  .regex(/^a(0|[1-9][0-9]?)$/)
  .transform((value): SlotId => `a${Number(value.slice(1))}`);

/** Slot ids of a run with `agents` slots, in dispatch order. */
export function slotIds(agents: number): readonly SlotId[] {
  return Array.from({ length: agents }, (_, index): SlotId => `a${index}`);
}

/** An invocation id as the harness writes it: `inv0007-rework`. */
export type InvocationId = `inv${string}`;

export const InvocationId = z
  .string()
  .regex(/^inv[0-9]{4,}-(initial|rework|fixer|test-author)$/)
  .transform((value): InvocationId => `inv${value.slice(3)}`);
