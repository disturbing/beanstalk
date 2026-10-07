/**
 * `GET /v1/whoami`: who a credential belongs to, the same check the git proxy makes (Basic
 * password or bearer). Lets people and agents test a token without touching a repo.
 */
import { Hono } from 'hono';

import type { AppEnv } from '../app-env';
import { presentedToken } from '../auth/credentials';
import { credentialFailure, verifyGitCredential } from '../auth/git-credential';

export const whoamiRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const token = presentedToken(c.req.raw);
  const challenge = { 'www-authenticate': 'Basic realm="beanstalk"' };
  if (token === null)
    return c.json(
      { error: { code: 'unauthorized', message: 'send a token as the password or bearer' } },
      401,
      challenge,
    );
  const check = await verifyGitCredential(c.env, token, c.var.deps.now());
  if (!check.ok)
    return c.json(
      { error: { code: 'unauthorized', message: credentialFailure(check) } },
      401,
      challenge,
    );
  if (check.kind === 'run')
    return c.json({
      kind: 'run',
      run: check.claims.run,
      scope: check.claims.scope,
      sub: check.claims.sub,
    });
  return c.json({
    kind: 'user',
    handle: check.user.handle,
    token: check.tokenKind,
    scopes: check.scopes,
  });
});
