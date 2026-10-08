/**
 * Actions over HTTP (doc 25; spike `docs/claude-opus/exp/actions-spike/README.md` §4):
 *
 * - `GET /v1/actions/runs/:run/jobs/:job/logs?token=` — a watcher's live log WebSocket, after
 *   the log ticket `logStream` issued; proxied to the run's ActionsRunDO untouched.
 * - GitHub-shaped git at the root (`/<owner>/<repo>[.git]/(info/refs|git-upload-pack|
 *   git-receive-pack)`): `actions/checkout` builds its remote as `<server url>/<owner>/<repo>`,
 *   dropping any path and `.git`, and sends `basic x-access-token:<token>`. The request is
 *   served as `/git/<owner>/<repo>.git/…` by the same proxy, with the same credential checks.
 */
import { Hono } from 'hono';

import type { AppEnv } from '../app-env';
import { verifyLogTicket } from '../actions/tickets';
import { readSecrets } from '../config';

const GITHUB_SHAPED_GIT =
  /^\/([A-Za-z0-9][A-Za-z0-9._-]{0,62})\/([A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*?)(?:\.git)?\/(info\/refs|git-upload-pack|git-receive-pack)$/;

export const actionsRoutes = new Hono<AppEnv>().get('/runs/:run/jobs/:job/logs', async (c) => {
  const token = c.req.query('token') ?? '';
  const claims = await verifyLogTicket(readSecrets(c.env).tokenSecret, token, Date.now());
  if (claims === null || claims.run !== c.req.param('run') || claims.job !== c.req.param('job'))
    return c.json(
      { error: { code: 'unauthorized', message: 'invalid or expired log ticket' } },
      401,
    );
  return c.env.ACTIONS_RUNS.getByName(claims.run).fetch(c.req.raw);
});

/**
 * The `/git/…` URL a GitHub-shaped git URL stands for, or null when the path is not one.
 * `/git/…` and `/v1/…` keep their own routes (they have more segments or no git suffix).
 */
export function githubShapedGitUrl(url: URL): URL | null {
  const match = GITHUB_SHAPED_GIT.exec(url.pathname);
  const [, owner, repo, rest] = match ?? [];
  if (owner === undefined || repo === undefined || rest === undefined) return null;
  const rewritten = new URL(url);
  rewritten.pathname = `/git/${owner}/${repo}.git/${rest}`;
  return rewritten;
}
