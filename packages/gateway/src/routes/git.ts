/**
 * The git smart-HTTP proxy, `/git/<namespace>/<repo>.git/…`. The credential is checked
 * (`verifyGitCredential`: run tokens, and people's tokens refused here until repositories), the
 * RunDO decides whether this principal may read or write this repo (and which refs), and
 * the request is forwarded to Artifacts with a token the agent never sees. Bodies stream
 * through; only the command list at the head of a push is read, to enforce the ref rules.
 */
import { Hono } from 'hono';

import type { AppEnv } from '../app-env';
import { presentedToken } from '../auth/credentials';
import { credentialFailure, verifyGitCredential } from '../auth/git-credential';
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
  if (token === null) return c.text('a run token or user token is required', 401, CHALLENGE);
  const check = await verifyGitCredential(c.env, token, deps.now());
  if (!check.ok) return c.text(credentialFailure(check), 401, CHALLENGE);
  // People's tokens open persistent repositories (Phase 2); race repos belong to their run.
  if (check.kind === 'user')
    return c.text('race repos take run tokens; user tokens open repositories', 403);
  if (check.claims.scope === 'contributor') {
    return c.text('contributor tokens authorize collaboration tools only', 403);
  }
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
