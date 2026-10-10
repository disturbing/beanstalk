/**
 * Admin routes for repository engines (the git-native flow). The repository side calls the
 * same operations over RPC (`RepoEngineRpc`); these let an operator open an engine on an
 * Artifacts repo, mint a git token and read the pushed beans with curl (the staging demo).
 */
import { Hono } from 'hono';
import { z } from 'zod';

import type { RpcResult } from '@gitstalk/shared-race/rpc';

import { artifactsPort } from '../adapters/artifacts';
import { repositoryStorage } from '../adapters/repository-storage';
import type { AppEnv } from '../app-env';
import { GatewayError } from '../errors';
import { requireAdmin } from '../middleware/auth';
import { OpenRepoEngineInput } from '../push/repo-engine';
import { openRepoEngine, repoEngineRpc } from '../rpc/repo-engine-rpc';
import { RunParam, validate } from './validation';

const OpenBody = OpenRepoEngineInput.extend({
  /** Creates the Artifacts repo first when it does not exist (the repository side normally does). */
  create_artifacts_repo: z.boolean().default(false),
  /**
   * Imports a public git repository into the Artifacts repo first (its default branch's history)
   * and starts the sprout and the stalk at that branch's head: how an operator opens an engine on
   * existing history, as the repository side's "import a public git URL" does.
   */
  import_url: z
    .url({ protocol: /^https$/ })
    .nullable()
    .default(null),
});
const TokenBody = z.strictObject({
  user: z.strictObject({ id: z.string().min(1).max(100), handle: z.string().min(1).max(32) }),
  ttl_seconds: z
    .number()
    .int()
    .min(60)
    .max(30 * 24 * 3600)
    .default(3600),
});
const EngineParam = z.object({ engine: RunParam.shape.run });
const CloseBody = z.strictObject({ delete_repo: z.boolean().default(false) });

export const repoRoutes = new Hono<AppEnv>()
  .post('/', requireAdmin, validate('json', OpenBody), async (c) => {
    const { create_artifacts_repo: create, import_url: importUrl, ...input } = c.req.valid('json');
    if (importUrl !== null) await importArtifactsRepo(c.env, input.artifactsRepo, importUrl);
    else if (create) await ensureArtifactsRepo(c.env, input.artifactsRepo);
    const opened = value(await openRepoEngine(c.var.deps, input));
    return c.json(opened, opened.created ? 201 : 200);
  })
  .post(
    '/:engine/git-token',
    requireAdmin,
    validate('param', EngineParam),
    validate('json', TokenBody),
    async (c) => {
      const { user, ttl_seconds } = c.req.valid('json');
      const rpc = repoEngineRpc(c.var.deps);
      return c.json(value(await rpc.gitToken(c.req.valid('param').engine, user, ttl_seconds)), 201);
    },
  )
  .get('/:engine/beans', requireAdmin, validate('param', EngineParam), async (c) => {
    return c.json(value(await repoEngineRpc(c.var.deps).pushedBeans(c.req.valid('param').engine)));
  })
  .post(
    '/:engine/close',
    requireAdmin,
    validate('param', EngineParam),
    validate('json', CloseBody),
    async (c) => {
      const rpc = repoEngineRpc(c.var.deps);
      const { delete_repo: deleteRepo } = c.req.valid('json');
      return c.json(value(await rpc.closeRepoEngine(c.req.valid('param').engine, { deleteRepo })));
    },
  );

async function ensureArtifactsRepo(env: Env, name: string): Promise<void> {
  const artifacts = artifactsPort(env.REPOS);
  const existing = await artifacts.listRepos((candidate) => candidate === name);
  if (existing.length === 0) await artifacts.createRepo(name, `beanstalk repository ${name}`);
}

async function importArtifactsRepo(env: Env, name: string, url: string): Promise<void> {
  const storage = repositoryStorage(env.REPOS);
  await storage.importFrom(name, url, `beanstalk repository ${name}, imported from ${url}`);
  if ((await storage.lineFromDefault(name)) === null) {
    throw new GatewayError(`${url} has no commits to import`, 'invalid_request', 400);
  }
}

function value<T>(result: RpcResult<T>): T {
  if (result.ok) return result.value;
  const { message, code, status } = result.error;
  throw new GatewayError(message, code, isStatus(status) ? status : 502);
}

function isStatus(status: number): status is GatewayError['status'] {
  return [400, 401, 403, 404, 409, 410, 413, 422, 500, 502, 503, 504].includes(status);
}
