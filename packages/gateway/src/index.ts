import { WorkerEntrypoint } from 'cloudflare:workers';

import type {
  BeanDetail,
  BeanSummary,
  DecisionRecord,
  GatewayRpc,
  RepoDiff,
  RepoFile,
  RepoGrep,
  RepoLog,
  RepoTree,
  RpcResult,
  RunEventsPage,
  RunListItem,
  RunView,
  TestCoverage,
  ViewToken,
} from '@beanstalk/shared-race/rpc';

import { createApp } from './app';
import { createDeps } from './deps';
import { gatewayRpc } from './rpc/gateway-rpc';

export { RunDO } from './run/run-do';
export { RunIndex } from './run/run-index';
export { Runner } from './runner/runner-container';
// Required by @cloudflare/containers for outbound interception (allowed and denied hosts).
export { ContainerProxy } from '@cloudflare/containers';

/**
 * beanstalk-gateway: race runs, the driver API, the git proxy and the live page over HTTP,
 * and the web app's RPC surface (`GatewayRpc`) over its service binding.
 */
export default class Gateway extends WorkerEntrypoint<Env> implements GatewayRpc {
  override async fetch(request: Request): Promise<Response> {
    const app = createApp(createDeps(this.env));
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

  repoTree(run: string, ref: string, path?: string): Promise<RpcResult<RepoTree>> {
    return this.#rpc().repoTree(run, ref, path);
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
  ): Promise<RpcResult<RepoGrep>> {
    return this.#rpc().repoGrep(run, ref, pattern, paths);
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

  #rpc(): GatewayRpc {
    return gatewayRpc(this.env, createDeps(this.env));
  }
}
