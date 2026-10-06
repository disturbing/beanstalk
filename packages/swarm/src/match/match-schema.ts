import { z } from 'zod';

/** A seat name: what `scripts/seed-seat.sh` stores a ChatGPT login under. */
export const SeatNameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);

/** How Codex in a match's containers is authorised. The containers never hold either credential. */
export const CredentialSchema = z.discriminatedUnion('mode', [
  /** Replay agents: no model at all. */
  z.object({ mode: z.literal('none') }),
  /** The Worker secret OPENAI_API_KEY, added by the model.internal handler. */
  z.object({ mode: z.literal('api-key') }),
  /** One leased ChatGPT seat; its token is added by the handler for the lease holder only. */
  z.object({ mode: z.literal('lease'), seat: SeatNameSchema.default('default') }),
]);
export type Credential = z.infer<typeof CredentialSchema>;

/** A gateway slot id (`a1`, `a2`, …) and its slot token. */
export const SlotSchema = z.object({
  slot: z.string().regex(/^[a-z]\d{1,4}$/),
  token: z.string().min(8).max(4096),
});

/** `POST /v1/matches`: an already created and seeded gateway run whose slots the swarm drives. */
export const MatchCreateSchema = z
  .object({
    gateway_run: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    slots: z.array(SlotSchema).min(1).max(64),
    credential: CredentialSchema,
    /** Agent spend (from the slots' progress and result posts) plus container cost. */
    max_usd: z.number().positive().max(10_000).nullable().optional(),
    /** Handed to each slot as is (policy, v2, guards, base_sha, arena digest, race config). */
    driver: z.record(z.string(), z.unknown()),
  })
  .refine((body) => new Set(body.slots.map((s) => s.slot)).size === body.slots.length, {
    message: 'slot ids must be unique',
  })
  .refine((body) => body.credential.mode !== 'lease' || body.slots.length === 1, {
    message: 'a leased ChatGPT seat serves one agent (one auth.json per serialised stream)',
  });
export type MatchCreate = z.infer<typeof MatchCreateSchema>;

export const HaltSchema = z.object({
  reason: z.string().max(200).default('halted by the operator'),
});
