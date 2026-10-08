import { describe, expect, it } from 'vitest';

import { githubShapedGitUrl } from '../src/routes/actions';
import {
  GIT_UA,
  GitStream,
  advertisedRefs,
  gitResponse,
  openRepo,
  push,
  pushBody,
  release,
} from './git-push-helpers';
import { call, sha } from './helpers';

/**
 * Git at GitHub's paths (`/<owner>/<repo>[.git]/…`), as `actions/checkout` and the web host
 * send them: the same proxy, credentials and verdicts as `/git/<owner>/<repo>.git/…`.
 */

type Repo = { readonly paths: readonly string[]; readonly token: string };

async function repo(name: string): Promise<Repo> {
  const { opened, token } = await openRepo(name);
  const bare = opened.git_path.replace(/^\/git/, '').replace(/\.git$/, '');
  return { paths: [bare, `${bare}.git`], token };
}

describe('git at /<owner>/<repo>[.git]', () => {
  it('advertises refs with and without .git, with checkout’s x-access-token header', async () => {
    const target = await repo('host-refs');
    for (const path of target.paths) {
      // oxlint-disable-next-line no-await-in-loop -- two paths, one after the other
      const response = await call('GET', `${path}/info/refs?service=git-upload-pack`, {
        headers: { ...GIT_UA, authorization: `Basic ${btoa(`x-access-token:${target.token}`)}` },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(
        'application/x-git-upload-pack-advertisement',
      );
    }
  });

  it('fetches (upload-pack) and refuses a bad token', async () => {
    const target = await repo('host-fetch');
    const [path] = target.paths;
    const fetched = await call('POST', `${path}/git-upload-pack`, {
      body: '0000',
      headers: {
        ...GIT_UA,
        authorization: `Basic ${btoa(`x:${target.token}`)}`,
        'content-type': 'application/x-git-upload-pack-request',
      },
    });
    expect(fetched.status).toBe(200);
    const refused = await call('GET', `${path}/info/refs?service=git-upload-pack`, {
      headers: { ...GIT_UA, authorization: `Basic ${btoa('x:not-a-token')}` },
    });
    expect(refused.status).toBeGreaterThanOrEqual(400);
  });

  it('pushes a bean, holds -o wait until the verdict, and refuses main', async () => {
    const target = await repo('host-push');
    const [, path] = target.paths;
    const plain = await gitResponse(
      await push(
        path ?? '',
        target.token,
        pushBody({ ref: 'refs/heads/bean/plain', newSha: await sha('host-plain') }),
      ),
    );
    expect(plain.report).toContain('ok refs/heads/bean/plain');

    const held = new GitStream(
      await push(
        path ?? '',
        target.token,
        pushBody({
          ref: 'refs/heads/bean/held-host',
          newSha: await sha('held-host'),
          options: ['wait'],
        }),
      ),
    );
    await held.until('pre-land check started');
    await release('held-host');
    expect((await held.rest()).remote).toContain('LANDED: held-host passed its pre-land check');

    const wait = new GitStream(
      await push(
        path ?? '',
        target.token,
        pushBody({ ref: 'refs/wait/any', newSha: await sha('host-wait'), options: ['bean=plain'] }),
      ),
    );
    expect((await wait.rest()).report).toContain('refs/wait/any');

    const main = await gitResponse(
      await push(
        path ?? '',
        target.token,
        pushBody({ ref: 'refs/heads/main', newSha: await sha('host-main') }),
      ),
    );
    expect(main.report).toContain('ng refs/heads/main');
    expect(await advertisedRefs(path ?? '', target.token)).toContain('refs/heads/bean/plain');
  });
});

describe('githubShapedGitUrl', () => {
  it('maps git endpoints and leaves pages alone', () => {
    const at = (path: string) =>
      githubShapedGitUrl(new URL(`https://web.test${path}`))?.pathname ?? null;
    expect(at('/coop/shop/info/refs')).toBe('/git/coop/shop.git/info/refs');
    expect(at('/coop/shop.git/git-upload-pack')).toBe('/git/coop/shop.git/git-upload-pack');
    expect(at('/coop/my.app.git/git-receive-pack')).toBe('/git/coop/my.app.git/git-receive-pack');
    for (const page of [
      '/coop/shop',
      '/coop/shop/tree/main',
      '/coop/shop/settings',
      '/coop/shop/info',
      '/coop/shop/blob/a/info/refs',
    ])
      expect(at(page)).toBeNull();
  });
});
