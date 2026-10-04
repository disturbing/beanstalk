/**
 * The git smart-HTTP proxy, `/git/<namespace>/<repo>.git/…`. The run token is checked, the
 * RunDO decides whether this principal may read or write this repo (and which refs), and
 * the request is forwarded to Artifacts with a token the agent never sees. Bodies stream
 * through; only the command list at the head of a push is read, to enforce the ref rules.
 */
import { Hono } from 'hono';

import type { AppEnv } from '../app-env';
import { presentedToken } from '../auth/credentials';
import { verifyToken } from '../auth/tokens';
import { forwardGit } from '../git/forward';
import { accessFor, parseGitPath } from '../git/git-path';
import { inspectPush, pushRefusal } from '../git/receive-pack';
import { runOfRepo } from '../run/run-names';

const CHALLENGE = { 'www-authenticate': 'Basic realm="beanstalk"' };

export const gitRoutes = new Hono<AppEnv>().all('/*', async (c) => {
  const deps = c.var.deps;
  const parsed = parseGitPath(new URL(c.req.url), c.req.method);
  if (!parsed.ok) return c.text(parsed.message, parsed.status);
  const { path } = parsed;
  if (path.namespace !== deps.config.namespace) return c.text('unknown namespace', 404);
  const token = presentedToken(c.req.raw);
  if (token === null) return c.text('a run token is required', 401, CHALLENGE);
  const check = await verifyToken(deps.tokenSecret, token, deps.now());
  if (!check.ok) return c.text(`run token ${check.failure.replace('_', ' ')}`, 401, CHALLENGE);
  const run = runOfRepo(path.repo);
  if (run === null || run !== check.claims.run)
    return c.text('this token belongs to another run', 403);
  const grant = await deps
    .run(run)
    .authorizeGit(
      { scope: check.claims.scope, sub: check.claims.sub },
      path.repo,
      accessFor(path.service),
    );
  if (!grant.ok) return c.text(grant.message, grant.status);
  let body = c.req.raw.body;
  if (path.rest === 'git-receive-pack' && grant.refs !== null) {
    if (c.req.header('content-encoding') !== undefined)
      return c.text('compressed pushes are not supported', 415);
    const inspection = await inspectPush(body);
    if (!inspection.ok) return c.text(inspection.reason, 400);
    const refusal = pushRefusal(inspection.commands, grant.refs);
    if (refusal !== null) return c.text(refusal, 403);
    body = inspection.body;
  }
  return forwardGit(c.req.raw, { upstream: grant.upstream, path, token: grant.token, body });
});
