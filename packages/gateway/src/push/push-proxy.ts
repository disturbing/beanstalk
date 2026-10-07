/**
 * The git-native flow's proxy (`docs/claude-opus/18-git-native-flow.md`): `/git/<owner>/<repo>.git`
 * of a repository's continuous engine. Clone and fetch pass through. A push to
 * `refs/heads/bean/<name>` is a submit: the gateway checks the refs before anything moves,
 * forwards the push to Artifacts, hands the new head to the engine, and answers with `remote:`
 * lines (received, check started; with `-o wait`, the verdict). Pushes to the lines, other
 * branches and deletions are refused in the protocol, so git prints why.
 */
import { logIdentity, recordProductEvent } from '@beanstalk/shared-identity/product-events';
import type { TaskId } from '@beanstalk/shared-race/ids';
import { RunId, Sha } from '@beanstalk/shared-race/ids';

import type { GitCredential, RepositoryAccess, RepositoryPrincipal } from '../auth/git-credential';
import { mayUseEngine, roleOf } from '../auth/git-credential';
import { notConnected } from '../auth/connect-hint';
import type { Deps } from '../deps';
import { withCapabilities } from '../git/advertisement';
import { forwardGit } from '../git/forward';
import type { GitPath } from '../git/git-path';
import { accessFor } from '../git/git-path';
import { FLUSH_PKT, concatBytes, remoteLines } from '../git/pkt-line';
import type { PushRequest } from '../git/push-request';
import { readPushRequest } from '../git/push-request';
import type { ReportMode } from '../git/receive-pack-report';
import {
  parseReportStatus,
  refusalResponse,
  reportMode,
  withRemoteLines,
  withoutFinalFlush,
} from '../git/receive-pack-report';
import { accessFacts } from '../repos/access';
import type { SessionUse } from '../repos/collaborators';
import type { RunDO } from '../run/run-do';
import { PROTECTED_BRANCHES, beanOfPushedRef } from './bean-refs';
import type { PushProgress } from './push-bean';
import { parsePushOptions } from './push-intent';
import { checkStartedLines, receivedLines, statusHint } from './push-messages';
import { repoEngineId } from './repo-engine';

const RESULT_TYPE = 'application/x-git-receive-pack-result';
const ADVERTISED = ['push-options'];
/** How often a waiting push asks the engine, and how often it shows it is still waiting. */
const WAIT_POLL_MS = 1000;
const KEEPALIVE_MS = 15_000;
const ZERO_SHA = '0'.repeat(40);

export type RepoGitRequest = {
  readonly request: Request;
  readonly path: GitPath;
  /** Null when git sent no credential: a public repository is cloned anonymously. */
  readonly credential: GitCredential | null;
  readonly deps: Deps;
  readonly ctx: Pick<ExecutionContext, 'waitUntil'>;
};

type Engine = DurableObjectStub<RunDO>;

/** Serves one smart-HTTP request of a repository engine. */
export async function repoGit(input: RepoGitRequest): Promise<Response> {
  const { path, credential, deps } = input;
  const principal: RepositoryPrincipal =
    credential === null ? { kind: 'anonymous' } : { kind: 'credential', credential };
  const repository = await repositoryAt(deps, path, principal);
  const access = accessFor(path.service);
  // A repository the credential may not use is answered as missing: its existence is not
  // told. Without a credential git is asked for one instead, as for a missing repository.
  const missing =
    credential === null
      ? notConnected('missing', deps.config.webUrl)
      : text(404, `no repository ${path.namespace}/${path.repo}`);
  if (repository === null) return missing;
  const verdict = mayUseEngine(principal, repository.access, access);
  if (verdict !== 'allowed') {
    if (verdict === 'not-found' || credential === null) return missing;
    return text(403, refusalText(credential, repository.access, access));
  }
  const engineId = repository.access.engine;
  const engine = deps.run(engineId);
  if ((await engine.repoEngine()) === null) return missing;
  const use = credential === null ? null : sessionUse(credential, repository.repoId);
  if (path.rest === 'git-receive-pack')
    // Pushing is never allowed without a credential, so `credential` is set here.
    return credential === null ? missing : push(input, { engine, engineId, use, credential });
  if (use !== null) input.ctx.waitUntil(recordUse(deps, use, 'read'));
  const grant = await engine.repoGitGrant(access);
  if (!grant.ok) return text(grant.status, grant.message);
  const response = await forwardGit(input.request, {
    upstream: grant.upstream,
    path,
    token: grant.token,
    body: input.request.body,
  });
  if (path.rest !== 'info/refs' || path.service !== 'git-receive-pack' || !response.ok)
    return response;
  const advertisement = new Uint8Array(await response.arrayBuffer());
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(withCapabilities(advertisement, ADVERTISED), { status: 200, headers });
}

/**
 * The repository a path names: the registry's record (its engine survives a rename), or for
 * an engine opened without one (the admin route) the engine derived from the path, private.
 * A repository's old name (its derived engine now belongs to a renamed record) names nothing.
 */
async function repositoryAt(
  deps: Deps,
  path: GitPath,
  principal: RepositoryPrincipal,
): Promise<{ readonly access: RepositoryAccess; readonly repoId: string | null } | null> {
  const record = await deps.registry.byName(path.namespace, path.repo);
  if (record !== null && RunId.safeParse(record.engine_id).success)
    return { access: await accessFacts(deps.collaborators, record, principal), repoId: record.id };
  const derived = await repoEngineId(path.namespace, path.repo);
  if ((await deps.registry.byEngine(derived)) !== null) return null;
  return {
    access: {
      engine: derived,
      owner: { id: null, handle: path.namespace },
      visibility: 'private',
      collaboratorRole: null,
    },
    repoId: null,
  };
}

/** What git prints when someone who can see the repository may not do this. */
function refusalText(
  credential: GitCredential,
  repository: RepositoryAccess,
  access: 'read' | 'write',
): string {
  const role = roleOf({ kind: 'credential', credential }, repository);
  const needs = access === 'write' ? 'push beans' : 'read';
  if (credential.engine !== null) return `this token may not ${needs} here (read-only access)`;
  if (role === null)
    return `${repository.owner.handle}'s repository is public to read; to ${needs} ask its owner for the write role`;
  if (role === 'read' && access === 'write')
    return `your role on this repository is read; to push beans you need the write role`;
  return `this credential may not ${needs} (its scopes do not include it)`;
}

type Use = Omit<SessionUse, 'action'>;

/** A person's credential on a registry repository, for its sessions list; null otherwise. */
function sessionUse(credential: GitCredential, repoId: string | null): Use | null {
  if (repoId === null || credential.session === null) return null;
  return {
    repoId,
    user: credential.user,
    via: credential.session.via,
    credentialId: credential.session.id,
    label: '',
  };
}

async function recordUse(deps: Deps, use: Use, action: 'read' | 'push'): Promise<void> {
  await deps.collaborators.recordUse({ ...use, action }).catch((error: unknown) => {
    deps.log.warn('session use not recorded', { repo: use.repoId, error });
  });
}

/** The product event and log line for a bean a person pushed (hashed ids only). */
async function recordPush(deps: Deps, credential: GitCredential): Promise<void> {
  const userId = credential.user.id;
  await recordProductEvent(deps.productEvents, 'bean_push', {
    userId,
    detail: credential.session?.via ?? '',
  });
  deps.log.info(
    'bean pushed',
    await logIdentity({ userId, sessionId: credential.session?.id ?? null }),
  );
}

async function push(
  input: RepoGitRequest,
  target: { engine: Engine; engineId: RunId; use: Use | null; credential: GitCredential },
): Promise<Response> {
  if (input.request.headers.get('content-encoding') !== null)
    return text(415, 'compressed pushes are not supported');
  const read = await readPushRequest(input.request.body);
  if (!read.ok) return text(400, read.reason);
  const { request } = read;
  const mode = reportMode(request.capabilities);
  const options = parsePushOptions(request.options);
  const checked = await checkCommands(request, target.engine);
  if (!checked.ok) {
    await request.upstreamBody.cancel();
    return refused(request, mode, checked.reason);
  }
  const grant = await target.engine.repoGitGrant('write');
  if (!grant.ok) return text(grant.status, grant.message);
  const upstream = await forwardGit(input.request, {
    upstream: grant.upstream,
    path: input.path,
    token: grant.token,
    body: request.upstreamBody,
  });
  const bytes = new Uint8Array(await upstream.arrayBuffer());
  const report = upstream.ok ? parseReportStatus(bytes, mode) : null;
  const moved =
    report?.unpackOk === true && report.refs.some((ref) => ref.ok && ref.ref === checked.ref);
  if (!moved) return bytesResponse(bytes, upstream.headers, upstream.status);
  const submitted = await target.engine.submitPush({
    bean: checked.bean,
    head: checked.head,
    actor: target.credential.user.handle,
    options,
  });
  if (submitted.ok && target.use !== null)
    input.ctx.waitUntil(recordUse(input.deps, target.use, 'push'));
  if (submitted.ok) input.ctx.waitUntil(recordPush(input.deps, target.credential));
  if (!submitted.ok) {
    const lines = [
      `beanstalk: the bean's branch moved, but the engine did not take it: ${submitted.reason}`,
    ];
    return bytesResponse(withRemoteLines(bytes, mode, lines), upstream.headers);
  }
  const lines = [
    ...receivedLines({ ...submitted.received, unknownOptions: options.unknown }),
    ...checkStartedLines(options.waitSeconds),
    ...(options.waitSeconds === null ? statusHint(checked.bean) : []),
  ];
  if (options.waitSeconds === null || !mode.sideband)
    return bytesResponse(withRemoteLines(bytes, mode, lines), upstream.headers);
  return waitingResponse({
    upstream: bytes,
    headers: upstream.headers,
    lines,
    wait: {
      engine: target.engine,
      bean: checked.bean,
      push: submitted.push,
      seconds: options.waitSeconds,
    },
    ctx: input.ctx,
  });
}

type Checked =
  | { readonly ok: true; readonly ref: string; readonly bean: TaskId; readonly head: Sha }
  | { readonly ok: false; readonly reason: string };

/** One bean per push, a branch under `refs/heads/bean/`, never a line, never a deletion. */
async function checkCommands(request: PushRequest, engine: Engine): Promise<Checked> {
  const { commands } = request;
  const lines = commands.find((command) => PROTECTED_BRANCHES.includes(command.ref));
  if (lines !== undefined) {
    return {
      ok: false,
      reason: `${lines.ref} is the engine's: landing is never a push. Push your work to refs/heads/bean/<name>; it lands when its pre-land check is green`,
    };
  }
  if (commands.some((command) => command.newSha === ZERO_SHA))
    return { ok: false, reason: 'deleting refs is not allowed' };
  const command = commands[0];
  if (command === undefined) return { ok: false, reason: 'nothing to push' };
  if (commands.length > 1)
    return { ok: false, reason: 'push one bean at a time (one refs/heads/bean/<name> per push)' };
  const bean = beanOfPushedRef(command.ref);
  if (bean === null) {
    return {
      ok: false,
      reason: `only beans are pushed: refs/heads/bean/<name> (letters, digits, . _ -; up to 32), not ${command.ref}`,
    };
  }
  const refusal = await engine.pushRefusal(bean);
  if (refusal !== null) return { ok: false, reason: refusal };
  return { ok: true, ref: command.ref, bean, head: Sha.parse(command.newSha) };
}

function refused(request: PushRequest, mode: ReportMode, reason: string): Response {
  const refs = request.commands.map((command) => command.ref);
  const lines = [`beanstalk: push refused: ${reason}`];
  return bytesResponse(refusalResponse(refs, reason, { mode, lines }), new Headers());
}

type Wait = { engine: Engine; bean: string; push: number; seconds: number };

/**
 * `-o wait`: the upstream's report, the received lines, then progress as the engine reports
 * it and the verdict (or a timeout), then the closing flush. Streamed, with a keepalive line,
 * so the client and every proxy between see the push is alive.
 */
function waitingResponse(input: {
  upstream: Uint8Array;
  headers: Headers;
  lines: readonly string[];
  wait: Wait;
  ctx: Pick<ExecutionContext, 'waitUntil'>;
}): Response {
  const head = withoutFinalFlush(input.upstream);
  if (head === null) return bytesResponse(input.upstream, input.headers);
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const work = (async () => {
    try {
      await writer.write(concatBytes([head, remoteLines(input.lines)]));
      await writeVerdict(writer, input.wait);
      await writer.write(FLUSH_PKT);
      await writer.close();
    } catch {
      // The client went away: nothing is left to tell it.
      await writer.abort().catch(() => undefined);
    }
  })();
  input.ctx.waitUntil(work);
  return new Response(readable, { status: 200, headers: resultHeaders(input.headers) });
}

async function writeVerdict(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  wait: Wait,
): Promise<void> {
  const startMs = Date.now();
  let after = 0;
  let shownMs = startMs;
  for (;;) {
    // oxlint-disable-next-line no-await-in-loop -- the wait asks the engine in turn
    const progress = await wait.engine.pushProgress(wait.bean, wait.push, after);
    if (progress === null) return;
    const shown = orderedLines(progress);
    after = progress.lines.at(-1)?.n ?? after;
    if (shown.length > 0) {
      // oxlint-disable-next-line no-await-in-loop -- lines go out as they come
      await writer.write(remoteLines(shown));
      shownMs = Date.now();
    }
    if (progress.verdict !== null) {
      // oxlint-disable-next-line no-await-in-loop -- the last lines
      await writer.write(remoteLines(statusHint(wait.bean)));
      return;
    }
    const waitedMs = Date.now() - startMs;
    if (waitedMs > wait.seconds * 1000) {
      const line = `beanstalk: still ${progress.phase} after ${Math.round(waitedMs / 1000)} s; the verdict will be on refs/beans/${wait.bean}/status`;
      // oxlint-disable-next-line no-await-in-loop -- the timeout line
      await writer.write(remoteLines([line]));
      return;
    }
    if (Date.now() - shownMs >= KEEPALIVE_MS) {
      // oxlint-disable-next-line no-await-in-loop -- keepalive
      await writer.write(
        remoteLines([`beanstalk: still checking (${Math.round(waitedMs / 1000)} s)`]),
      );
      shownMs = Date.now();
    }
    // oxlint-disable-next-line no-await-in-loop -- the engine is asked again shortly
    await scheduler.wait(WAIT_POLL_MS);
  }
}

/** New lines in order: those before the verdict, the verdict, then those after it. */
function orderedLines(progress: PushProgress): string[] {
  const verdict = progress.verdict;
  if (verdict === null) return progress.lines.map((line) => line.text);
  const before = progress.lines.filter((line) => line.n <= verdict.after).map((line) => line.text);
  const later = progress.lines.filter((line) => line.n > verdict.after).map((line) => line.text);
  return [...before, ...verdict.lines, ...later];
}

function resultHeaders(upstream: Headers): Headers {
  const headers = new Headers(upstream);
  headers.delete('content-length');
  headers.set('content-type', RESULT_TYPE);
  headers.set('cache-control', 'no-cache');
  return headers;
}

function bytesResponse(bytes: Uint8Array, upstream: Headers, status = 200): Response {
  return new Response(bytes, { status, headers: resultHeaders(upstream) });
}

function text(status: number, message: string): Response {
  return new Response(`${message}\n`, { status, headers: { 'content-type': 'text/plain' } });
}
