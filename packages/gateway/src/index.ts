import { WorkerEntrypoint } from 'cloudflare:workers';

import type {
  BeanContext,
  BeanContextInput,
  BeanDiscoverInput,
  BeanDiscoverPage,
  BeanInboxAckInput,
  BeanInboxAckResult,
  BeanInboxPage,
  BeanInboxReadInput,
  BeanPeerSummary,
  BeanThreadPostInput,
  BeanThreadPostResult,
  BeanUpdateInput,
  BeanUpdateResult,
} from '@beanstalk/shared-race/collaboration';

import type {
  BeanDetail,
  BeanStream,
  BeanStreamSummary,
  BeanSummary,
  DecisionRecord,
  GatewayRpc,
  GitToken,
  McpTokenClaims,
  OpenRepoEngineInput,
  PushedBeanStatus,
  RepoDiff,
  RepoFile,
  RepoGrep,
  RepoLog,
  RepoEngineOpened,
  RepoEngineRpc,
  RepoTree,
  RpcResult,
  RunEventsPage,
  RunListItem,
  RunView,
  TestCoverage,
  ViewToken,
  ViewTokenClaims,
} from '@beanstalk/shared-race/rpc';

import { createApp } from './app';
import { createDeps } from './deps';
import { gatewayRpc } from './rpc/gateway-rpc';
import { collaborationRpc } from './rpc/collaboration-rpc';
import { repoEngineRpc } from './rpc/repo-engine-rpc';

export { RunDO } from './run/run-do';
export { RunIndex } from './run/run-index';
export { RunStreamDO } from './stream/run-stream-do';
export { Runner } from './runner/runner-container';
// Required by @cloudflare/containers for outbound interception (allowed and denied hosts).
export { ContainerProxy } from '@cloudflare/containers';

/** Built once per isolate; the deps are injected per request from the request's env. */
const app = createApp(createDeps);

/**
 * beanstalk-gateway: race runs, the driver API, the git proxy and the live page over HTTP,
 * and the web app's RPC surface (`GatewayRpc`) over its service binding.
 */
export default class Gateway extends WorkerEntrypoint<Env> implements GatewayRpc, RepoEngineRpc {
  override async fetch(request: Request): Promise<Response> {
    return app.fetch(request, this.env, this.ctx);
  }

  listRuns(limit?: number): Promise<readonly RunListItem[]> {
    return this.#rpc().listRuns(limit);
  }

  runView(run: string): Promise<RpcResult<RunView>> {
    return this.#rpc().runView(run);
  }

  runEvents(run: string, after: number, limit: number): Promise<RpcResult<RunEventsPage>> {
    return this.#rpc().runEvents(run, after, limit);
  }

  decide(
    run: string,
    card: string,
    winner: string,
    actor: string,
    text?: string,
  ): Promise<RpcResult<{ readonly accepted: true }>> {
    return this.#rpc().decide(run, card, winner, actor, text);
  }

  viewToken(run: string): Promise<RpcResult<ViewToken>> {
    return this.#rpc().viewToken(run);
  }

  repoTree(
    run: string,
    ref: string,
    path?: string,
    recursive?: boolean,
  ): Promise<RpcResult<RepoTree>> {
    return this.#rpc().repoTree(run, ref, path, recursive);
  }

  repoFile(run: string, ref: string, path: string): Promise<RpcResult<RepoFile>> {
    return this.#rpc().repoFile(run, ref, path);
  }

  repoDiff(
    run: string,
    fromRef: string,
    toRef: string,
    paths?: readonly string[],
  ): Promise<RpcResult<RepoDiff>> {
    return this.#rpc().repoDiff(run, fromRef, toRef, paths);
  }

  repoLog(
    run: string,
    ref: string,
    paths: readonly string[] | null,
    limit: number,
  ): Promise<RpcResult<RepoLog>> {
    return this.#rpc().repoLog(run, ref, paths, limit);
  }

  repoGrep(
    run: string,
    ref: string,
    pattern: string,
    paths?: readonly string[],
    regex?: boolean,
  ): Promise<RpcResult<RepoGrep>> {
    return this.#rpc().repoGrep(run, ref, pattern, paths, regex);
  }

  beansByPath(run: string, paths: readonly string[]): Promise<RpcResult<readonly BeanSummary[]>> {
    return this.#rpc().beansByPath(run, paths);
  }

  beanDetail(run: string, bean: string): Promise<RpcResult<BeanDetail>> {
    return this.#rpc().beanDetail(run, bean);
  }

  decisions(run: string, paths?: readonly string[]): Promise<RpcResult<readonly DecisionRecord[]>> {
    return this.#rpc().decisions(run, paths);
  }

  testsFor(run: string, paths: readonly string[]): Promise<RpcResult<readonly TestCoverage[]>> {
    return this.#rpc().testsFor(run, paths);
  }

  beanStreams(run: string): Promise<RpcResult<readonly BeanStreamSummary[]>> {
    return this.#rpc().beanStreams(run);
  }

  beanStream(run: string, bean: string): Promise<RpcResult<BeanStream | null>> {
    return this.#rpc().beanStream(run, bean);
  }

  verifyViewToken(token: string): Promise<RpcResult<ViewTokenClaims>> {
    return this.#rpc().verifyViewToken(token);
  }

  verifyMcpToken(token: string): Promise<RpcResult<McpTokenClaims>> {
    return collaborationRpc(createDeps(this.env)).verifyMcpToken(token);
  }

  beanContext(run: string, input: BeanContextInput): Promise<RpcResult<BeanContext>> {
    return collaborationRpc(createDeps(this.env)).beanContext(run, input);
  }

  beanDiscover(run: string, input: BeanDiscoverInput): Promise<RpcResult<BeanDiscoverPage>> {
    return collaborationRpc(createDeps(this.env)).beanDiscover(run, input);
  }

  beanPeerSummaries(
    run: string,
    beans: readonly string[],
  ): Promise<RpcResult<readonly BeanPeerSummary[]>> {
    return collaborationRpc(createDeps(this.env)).beanPeerSummaries(run, beans);
  }

  beanUpdate(token: string, input: BeanUpdateInput): Promise<RpcResult<BeanUpdateResult>> {
    return collaborationRpc(createDeps(this.env)).beanUpdate(token, input);
  }

  beanThreadPost(
    token: string,
    input: BeanThreadPostInput,
  ): Promise<RpcResult<BeanThreadPostResult>> {
    return collaborationRpc(createDeps(this.env)).beanThreadPost(token, input);
  }

  beanInboxRead(token: string, input: BeanInboxReadInput): Promise<RpcResult<BeanInboxPage>> {
    return collaborationRpc(createDeps(this.env)).beanInboxRead(token, input);
  }

  beanInboxAck(token: string, input: BeanInboxAckInput): Promise<RpcResult<BeanInboxAckResult>> {
    return collaborationRpc(createDeps(this.env)).beanInboxAck(token, input);
  }

  openRepoEngine(input: OpenRepoEngineInput): Promise<RpcResult<RepoEngineOpened>> {
    return repoEngineRpc(createDeps(this.env)).openRepoEngine(input);
  }

  gitToken(
    engineId: string,
    user: { readonly id: string; readonly handle: string },
    ttlSeconds?: number,
  ): Promise<RpcResult<GitToken>> {
    return repoEngineRpc(createDeps(this.env)).gitToken(engineId, user, ttlSeconds);
  }

  pushedBeans(engineId: string): Promise<RpcResult<readonly PushedBeanStatus[]>> {
    return repoEngineRpc(createDeps(this.env)).pushedBeans(engineId);
  }

  #rpc(): GatewayRpc {
    return gatewayRpc(this.env, createDeps(this.env));
  }
}
