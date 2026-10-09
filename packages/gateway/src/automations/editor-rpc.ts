/**
 * The automation builder's RPC (`AutomationEditorRpc`, doc 25 §7.13). A save is a bean, never a
 * push to a line: the gateway builds the commit from the file's new text, pushes it as
 * `bean/automation-<slug>-<short>` with the person's identity and hands it to the engine as any
 * push, so it lands only through the pre-land check. When the file changed on the latest landed
 * commit since the editor opened it, the save is refused as `stale` with that version, for the
 * editor to merge. Access: read to open, write to save (maintain when `.beanstalk/checks.toml`
 * protects the file), maintain to start a test run.
 */
import type {
  AutomationBase,
  AutomationBeanStatus,
  AutomationEditorRpc,
  AutomationSource,
  AutomationTheirs,
  SaveAccess,
  SaveAutomationResult,
} from '@beanstalk/shared-race/automation-editor';
import {
  AutomationPath,
  SaveAutomationInput,
  TestAutomationInput,
  automationBeanName,
} from '@beanstalk/shared-race/automation-editor';
import { readAutomationFile } from '@beanstalk/shared-race/automation-file';
import {
  CHECKS_PATH,
  matchesPattern,
  protectedPatterns,
  readChecksConfig,
} from '@beanstalk/shared-race/checks-config';
import type { RepositoryForViewer, ViewerRole } from '@beanstalk/shared-race/collaborators';
import { RunId, Sha, TaskId } from '@beanstalk/shared-race/ids';
import type { Viewer } from '@beanstalk/shared-race/repos';
import type { RpcError, RpcResult } from '@beanstalk/shared-race/rpc';

import { handleOf } from '../actions/actions-audit';
import { readActionsConfig } from '../actions/actions-config';
import { compileAutomation } from '../actions/automation-job';
import type { ProtectedAccess } from '../checks/protected-access';
import type { Deps } from '../deps';
import { ZERO_SHA, pushRefs } from '../git/remote-client';
import { pushedBeanRef } from '../push/bean-refs';
import { parsePushOptions } from '../push/push-intent';
import { accessResult, viewerPrincipal } from '../repos/access';
import type { RunDO } from '../run/run-do';
import { buildFileCommit } from './file-commit';

type Engine = DurableObjectStub<RunDO>;
type Opened = { readonly repo: RepositoryForViewer; readonly engine: Engine };

/** The line a save starts from and lands on: the latest landed commit. */
const LANDED = 'sprout';
const SHORT = 6;
const DECIDING: ReadonlySet<ViewerRole> = new Set(['owner', 'maintain']);

export function automationEditorRpc(env: Env, deps: Deps): AutomationEditorRpc {
  const open = async (
    viewer: Viewer,
    repoId: string,
    action: 'read' | 'write' | 'actions',
  ): Promise<RpcResult<Opened>> => {
    const allowed = await accessResult(deps.collaborators, await deps.registry.byId(repoId), {
      principal: viewerPrincipal(viewer),
      action,
      what: repoId,
    });
    if (!allowed.ok) return allowed;
    const engine = deps.run(RunId.parse(allowed.value.engine_id));
    return { ok: true, value: { repo: allowed.value, engine } };
  };
  const guarded = async <T>(work: () => Promise<RpcResult<T>>): Promise<RpcResult<T>> => {
    try {
      return await work();
    } catch (error: unknown) {
      deps.log.error('automation editor failed', { error });
      return failed({ code: 'internal', status: 500, message: 'internal error' });
    }
  };
  const limits = { maxTimeoutMinutes: readActionsConfig(env).jobTimeoutMinutes };

  return {
    automationSource: (viewer, repoId, path) =>
      guarded(async () => {
        const parsedPath = AutomationPath.safeParse(path);
        if (!parsedPath.success) return invalid(parsedPath.error.issues[0]?.message ?? 'bad path');
        const opened = await open(viewer, repoId, 'read');
        if (!opened.ok) return opened;
        const [current, protection] = await Promise.all([
          currentFile(opened.value.engine, parsedPath.data),
          protectionOf(opened.value.engine, parsedPath.data),
        ]);
        const role = opened.value.repo.viewer_role;
        return ok<AutomationSource>({
          path: parsedPath.data,
          base: current.base,
          content: current.content,
          role,
          save: saveAccess(opened.value.repo, protection),
          canTestRun: role !== null && DECIDING.has(role) && opened.value.repo.archived_at === null,
          protectedBy: protection,
          maxTimeoutMinutes: limits.maxTimeoutMinutes,
        });
      }),
    saveAutomation: (viewer, repoId, raw) =>
      guarded(async () => {
        const input = SaveAutomationInput.safeParse(raw);
        if (!input.success) return invalid(input.error.issues[0]?.message ?? 'invalid save');
        const opened = await open(viewer, repoId, 'write');
        if (!opened.ok) return opened;
        const { engine, repo } = opened.value;
        const { path, content } = input.data;
        const protection = await protectionOf(engine, path);
        const access = saveAccess(repo, protection);
        if (access.kind === 'refused')
          return failed({ code: 'forbidden', status: 403, message: access.reason });
        if (content !== null) {
          const file = readAutomationFile(path, content, limits);
          const [first] = file.problems;
          if (first !== undefined)
            return invalid(
              `${path}${first.line === null ? '' : `:${first.line}`}: ${first.message}`,
            );
        }
        const current = await currentFile(engine, path);
        if (current.base.blob !== input.data.base.blob)
          return ok<SaveAutomationResult>({
            kind: 'stale',
            theirs: await theirsOf(engine, path, current),
          });
        if (content === null && current.base.blob === null)
          return invalid(`${path} does not exist on the latest landed commit`);
        if (content !== null && content === current.content) return invalid('nothing changed');
        const handle = await handleOf(env, viewer);
        return pushSave(deps, {
          engine,
          base: current.base,
          path,
          content,
          handle,
          message: input.data.message ?? defaultMessage(path, content, current.content),
          protectedAccess: protectedAccessOf(handle, repo.viewer_role),
        });
      }),
    automationBean: (viewer, repoId, bean) =>
      guarded(async () => {
        const name = TaskId.safeParse(bean);
        if (!name.success) return invalid(`"${bean}" is not a bean name`);
        const opened = await open(viewer, repoId, 'read');
        if (!opened.ok) return opened;
        const { pushed } = await opened.value.engine.agentBean(name.data);
        if (pushed === null) return failed(notFound(`bean ${bean}`));
        return ok<AutomationBeanStatus>({
          bean: pushed.bean,
          phase: pushed.phase,
          reason: pushed.reason,
          landedSha: pushed.landedSha,
          details: [
            ...(pushed.rework?.failing ?? []).map((test) => `failing: ${test}`),
            ...(pushed.rework?.conflicts ?? []).map((file) => `conflict: ${file}`),
            ...(pushed.verdict?.lines ?? []),
          ].slice(0, 20),
        });
      }),
    testAutomation: (viewer, repoId, raw) =>
      guarded(async () => {
        const input = TestAutomationInput.safeParse(raw);
        if (!input.success) return invalid(input.error.issues[0]?.message ?? 'invalid draft');
        const opened = await open(viewer, repoId, 'actions');
        if (!opened.ok) return opened;
        const file = readAutomationFile(input.data.path, input.data.content, limits);
        const [first] = file.problems;
        if (first !== undefined || file.info === null)
          return invalid(`the draft is not valid: ${first?.message ?? 'no automation'}`);
        const stalk = await opened.value.engine.repoTree('stalk', '', false);
        if (!stalk.ok) return failed(stalk.error);
        const started = await env.ACTIONS_REPOS.getByName(repoId).testAutomation({
          repoId,
          path: input.data.path,
          // A test never writes the automation's memory: the compiled job has no save step.
          source: compileAutomation({ name: file.name, info: { ...file.info, memoryRef: null } }),
          sha: stalk.value.commit,
          actor: await handleOf(env, viewer),
          automation: { model: file.info.model, maxCostUsd: file.info.maxCostUsd },
        });
        return started.ok ? ok({ runId: started.value.id }) : started;
      }),
  };
}

/** Who may save: write to push a bean, maintain when the file is a protected path. */
export function saveAccess(repo: RepositoryForViewer, protectedBy: string | null): SaveAccess {
  const role = repo.viewer_role;
  if (repo.archived_at !== null)
    return { kind: 'refused', reason: 'This repository is archived, so it is read-only.' };
  if (role === null || role === 'read')
    return {
      kind: 'refused',
      reason: `Saving pushes a bean, which needs the write role; you have ${role === null ? 'no role' : 'the read role'}.`,
    };
  if (protectedBy !== null && !DECIDING.has(role))
    return {
      kind: 'refused',
      reason: `.beanstalk/checks.toml protects this file (${protectedBy}), so only maintainers and the owner may change it; you have the ${role} role.`,
    };
  return { kind: 'allowed' };
}

/** A save is the person's own change, made in the web editor they signed in to. */
export function protectedAccessOf(handle: string, role: ViewerRole | null): ProtectedAccess {
  return {
    allowed: role !== null && DECIDING.has(role),
    who: `@${handle} (${role ?? 'no role'}, with the web editor)`,
  };
}

type Current = { readonly base: AutomationBase; readonly content: string | null };

/** The file on the latest landed commit: that commit, its blob there and its text. */
async function currentFile(engine: Engine, path: string): Promise<Current> {
  const directory = path.slice(0, path.lastIndexOf('/'));
  const listed = await engine.repoTree(LANDED, directory, false);
  if (!listed.ok) {
    if (listed.error.status !== 404) throw new Error(listed.error.message);
    const root = await engine.repoTree(LANDED, '', false);
    if (!root.ok) throw new Error(root.error.message);
    return { base: { commit: root.value.commit, blob: null }, content: null };
  }
  const entry = listed.value.entries.find((candidate) => candidate.path === path);
  const commit = listed.value.commit;
  if (entry === undefined) return { base: { commit, blob: null }, content: null };
  const file = await engine.repoFile(commit, path);
  if (!file.ok) throw new Error(file.error.message);
  return { base: { commit, blob: entry.sha }, content: file.value.content };
}

/** The newer version, with the author of the newest commit that changed the file. */
async function theirsOf(engine: Engine, path: string, current: Current): Promise<AutomationTheirs> {
  const log = await engine.repoLog(current.base.commit, [path], 1);
  const commit = log.ok ? log.value.commits[0] : undefined;
  if (commit === undefined) return { base: current.base, content: current.content, author: null };
  return { base: current.base, content: current.content, author: await pusherOf(engine, commit) };
}

/**
 * Who changed it: a landed commit is the runner's squash, so the person is the pusher of the
 * bean its `Task:` trailer names; any other commit names its own author.
 */
async function pusherOf(
  engine: Engine,
  commit: { readonly message: string; readonly author: { readonly name: string } },
): Promise<string | null> {
  const task = /^Task: (\S+)$/m.exec(commit.message)?.[1];
  const bean = task === undefined ? null : TaskId.safeParse(task);
  if (bean?.success === true) {
    const { pushed } = await engine.agentBean(bean.data);
    if (pushed !== null) return pushed.actor;
  }
  return commit.author.name === 'beanstalk-runner' ? null : commit.author.name;
}

/** `protected_paths` of the latest landed `.beanstalk/checks.toml` that cover `path`. */
async function protectionOf(engine: Engine, path: string): Promise<string | null> {
  const checks = await engine.repoFile(LANDED, CHECKS_PATH);
  const text = checks.ok ? checks.value.content : null;
  const patterns = protectedPatterns(readChecksConfig(text));
  return patterns.find((pattern) => matchesPattern(path, pattern)) ?? null;
}

async function pushSave(
  deps: Deps,
  save: {
    readonly engine: Engine;
    readonly base: AutomationBase;
    readonly path: string;
    readonly content: string | null;
    readonly handle: string;
    readonly message: string;
    readonly protectedAccess: ProtectedAccess;
  },
): Promise<RpcResult<SaveAutomationResult>> {
  const { engine } = save;
  const built = await buildFileCommit(
    async (directory) => {
      const listed = await engine.repoTree(save.base.commit, directory, false);
      if (listed.ok) return listed.value.truncated ? tooLarge(directory) : listed.value.entries;
      if (listed.error.status === 404) return null;
      throw new Error(listed.error.message);
    },
    {
      base: save.base,
      path: save.path,
      content: save.content,
      author: { name: save.handle, email: emailOf(deps, save.handle), atMs: deps.now() },
      message: save.message,
    },
  );
  const bean = TaskId.parse(automationBeanName(save.path, built.commit.slice(0, SHORT)));
  const refusal = await engine.pushRefusal(bean, save.handle);
  if (refusal !== null) return failed({ code: 'conflict', status: 409, message: refusal });
  const grant = await engine.repoGitGrant('write');
  if (!grant.ok)
    return failed({ code: 'upstream_failed', status: grant.status, message: grant.message });
  const report = await pushRefs(
    { remote: grant.upstream, token: grant.token },
    [{ ref: pushedBeanRef(bean), oldSha: ZERO_SHA, newSha: built.commit }],
    built.objects,
  );
  const refused = report.refs.find((status) => !status.ok);
  if (!report.unpackOk || refused !== undefined)
    return failed({
      code: 'upstream_failed',
      status: 502,
      message: `the repository refused the bean: ${refused?.reason ?? 'unpack failed'}`,
    });
  const submitted = await engine.submitPush({
    bean,
    head: Sha.parse(built.commit),
    actor: save.handle,
    protectedAccess: save.protectedAccess,
    options: parsePushOptions([]),
  });
  if (!submitted.ok)
    return failed({ code: 'invalid_state', status: 409, message: submitted.reason });
  deps.log.info('automation saved as a bean', { bean, path: save.path });
  return ok<SaveAutomationResult>({ kind: 'pushed', bean, commit: built.commit });
}

function tooLarge(directory: string): never {
  throw new Error(`${directory || 'the root'} has more than 1,000 entries; save with git instead`);
}

function emailOf(deps: Deps, handle: string): string {
  return `${handle}@users.${new URL(deps.config.webUrl).hostname}`;
}

function defaultMessage(path: string, content: string | null, before: string | null): string {
  const file = path.split('/').at(-1) ?? path;
  if (content === null) return `Delete automation ${file}`;
  return before === null ? `Add automation ${file}` : `Edit automation ${file}`;
}

function ok<T>(value: T): RpcResult<T> {
  return { ok: true, value };
}

function failed<T>(error: RpcError): RpcResult<T> {
  return { ok: false, error };
}

function invalid<T>(message: string): RpcResult<T> {
  return failed({ code: 'invalid_request', status: 400, message });
}

function notFound(what: string): RpcError {
  return { code: 'not_found', status: 404, message: `no ${what}` };
}
