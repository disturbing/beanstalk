/**
 * `GET /v1/whoami`: who a credential belongs to, the same check the git proxy makes (Basic
 * password or bearer). Lets people and agents test a token without touching a repo.
 */
import { Hono } from 'hono';

import type { AppEnv } from '../app-env';
import { presentedToken } from '../auth/credentials';
import { verifyGitCredential } from '../auth/git-credential';
import { DEPLOY_TOKEN_PREFIX, usedFrom } from '../repos/deploy-tokens';

export const whoamiRoutes = new Hono<AppEnv>().get('/', async (c) => {
  const token = presentedToken(c.req.raw);
  const challenge = { 'www-authenticate': 'Basic realm="beanstalk"' };
  if (token === null)
    return c.json(
      { error: { code: 'unauthorized', message: 'send a token as the password or bearer' } },
      401,
      challenge,
    );
  const credential = await verifyGitCredential(
    { ...c.var.deps, identity: c.env, forge: c.env.FORGE, usedFrom: usedFrom(c.req.raw) },
    token,
  );
  if (credential === null)
    return c.json(
      { error: { code: 'unauthorized', message: 'invalid, expired or revoked token' } },
      401,
      challenge,
    );
  if (token.startsWith(DEPLOY_TOKEN_PREFIX))
    return c.json({
      kind: 'deploy',
      engine: credential.engine,
      handle: credential.user.handle,
      scopes: credential.scopes,
    });
  if (credential.engine !== null) {
    const contributor = credential.scopes.length === 0 ? 'contributor' : 'git';
    return c.json({
      kind: 'run',
      run: credential.engine,
      scope: credential.runPrincipal?.scope ?? contributor,
      sub: credential.user.handle,
      scopes: credential.scopes,
    });
  }
  return c.json({ kind: 'user', handle: credential.user.handle, scopes: credential.scopes });
});
