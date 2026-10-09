/**
 * The automation builder's adapter onto the gateway (`AutomationEditorRpc` on the GATEWAY
 * binding), every answer validated before the app trusts it. A gateway without the methods
 * reads as "the builder is not available here". Server-only.
 */
import { z } from 'zod';

import type {
  AutomationEditorRpc,
  SaveAutomationInput,
  TestAutomationInput,
} from '@beanstalk/shared-race/automation-editor';
import type { RpcResult } from '@beanstalk/shared-race/rpc';

const Base = z.object({ commit: z.string(), blob: z.string().nullable() });

export const AutomationSource = z.object({
  path: z.string(),
  base: Base,
  content: z.string().nullable(),
  role: z.enum(['read', 'write', 'maintain', 'owner']).nullable(),
  save: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('allowed') }),
    z.object({ kind: z.literal('refused'), reason: z.string() }),
  ]),
  canTestRun: z.boolean(),
  protectedBy: z.string().nullable(),
  maxTimeoutMinutes: z.number().int().positive().default(60),
});
export type AutomationSource = z.infer<typeof AutomationSource>;

export const Theirs = z.object({
  base: Base,
  content: z.string().nullable(),
  author: z.string().nullable(),
});
export type Theirs = z.infer<typeof Theirs>;

const SaveResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pushed'), bean: z.string(), commit: z.string() }),
  z.object({ kind: z.literal('stale'), theirs: Theirs }),
]);
export type SaveResult = z.infer<typeof SaveResult>;

export const BeanStatus = z.object({
  bean: z.string(),
  phase: z.enum(['checking', 'landed', 'green', 'red', 'conflict', 'waiting', 'parked', 'dropped']),
  reason: z.string(),
  landedSha: z.string().nullable(),
  details: z.array(z.string()),
});
export type BeanStatus = z.infer<typeof BeanStatus>;

/** What every call answers: the value, or the gateway's message for the person. */
export type EditorOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly status: number; readonly message: string };

export type EditorClient = {
  source(repoId: string, path: string): Promise<EditorOutcome<AutomationSource>>;
  save(repoId: string, input: SaveAutomationInput): Promise<EditorOutcome<SaveResult>>;
  bean(repoId: string, bean: string): Promise<EditorOutcome<BeanStatus>>;
  testRun(repoId: string, input: TestAutomationInput): Promise<EditorOutcome<{ runId: string }>>;
};

const METHODS = ['automationSource', 'saveAutomation', 'automationBean', 'testAutomation'];

/** The client for `viewer` (a user id), or null when the binding lacks the builder's RPC. */
export function editorClient(binding: unknown, viewer: string | null): EditorClient | null {
  if (typeof binding !== 'object' || binding === null || !isEditorRpc(binding)) return null;
  const rpc = binding;
  return {
    source: (repoId, path) => settle(rpc.automationSource(viewer, repoId, path), AutomationSource),
    save: (repoId, input) => settle(rpc.saveAutomation(viewer, repoId, input), SaveResult),
    bean: (repoId, bean) => settle(rpc.automationBean(viewer, repoId, bean), BeanStatus),
    testRun: (repoId, input) =>
      settle(rpc.testAutomation(viewer, repoId, input), z.object({ runId: z.string() })),
  };
}

function isEditorRpc(binding: object): binding is AutomationEditorRpc {
  return METHODS.every((method) => typeof Reflect.get(binding, method) === 'function');
}

async function settle<T>(
  call: Promise<RpcResult<unknown>>,
  schema: z.ZodType<T>,
): Promise<EditorOutcome<T>> {
  const answer = await call.catch(() => null);
  if (answer === null) return { ok: false, status: 502, message: 'The gateway did not answer.' };
  if (!answer.ok) return { ok: false, status: answer.error.status, message: answer.error.message };
  const parsed = schema.safeParse(answer.value);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, status: 502, message: 'The gateway answered in an unexpected shape.' };
}
