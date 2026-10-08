import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { answerForge, gitHeaders, routeForgeRequest } from '../src/outbound/forge-host';

const JOB = { repository: 'coop/app', checkoutUrl: 'https://gateway.example/git/coop/app.git' };

function url(path: string): URL {
  return new URL(`http://bs.internal${path}`);
}

describe('bs.internal routing', () => {
  it('sends the job’s own repository to the gateway’s git path', () => {
    expect(routeForgeRequest(url('/coop/app/info/refs?service=git-upload-pack'), JOB)).toEqual({
      kind: 'repository',
      url: 'https://gateway.example/git/coop/app.git/info/refs?service=git-upload-pack',
    });
    expect(routeForgeRequest(url('/Coop/App.git/git-upload-pack'), JOB)).toMatchObject({
      kind: 'repository',
    });
  });

  it('sends any other repository (an action) to github.com, read only', () => {
    expect(
      routeForgeRequest(url('/actions/setup-node/info/refs?service=git-upload-pack'), JOB),
    ).toEqual({
      kind: 'action',
      url: 'https://github.com/actions/setup-node.git/info/refs?service=git-upload-pack',
    });
    expect(routeForgeRequest(url('/actions/setup-node/git-receive-pack'), JOB)).toMatchObject({
      kind: 'refused',
      status: 403,
    });
  });

  it('refuses the REST API with the reason', () => {
    expect(routeForgeRequest(url('/api/v3/repos/coop/app'), JOB)).toMatchObject({
      kind: 'refused',
      status: 501,
    });
  });

  it('never sends the job token to github.com', () => {
    const request = new Request('http://bs.internal/actions/checkout/git-upload-pack', {
      headers: { authorization: 'basic dG9rZW46YnNqX3NlY3JldA==', 'git-protocol': 'version=2' },
    });
    expect(gitHeaders(request, false).has('authorization')).toBe(false);
    expect(gitHeaders(request, false).get('git-protocol')).toBe('version=2');
    expect(gitHeaders(request, true).get('authorization')).toBe('basic dG9rZW46YnNqX3NlY3JldA==');
  });

  it('forwards the repository’s git through the gateway binding with the credential', async () => {
    const request = new Request('http://bs.internal/coop/app/info/refs?service=git-upload-pack', {
      headers: { authorization: 'basic eC1hY2Nlc3MtdG9rZW46YnNqXzE=' },
    });
    const response = await answerForge(request, JOB, env.GATEWAY);
    expect(await response.json()).toEqual({
      url: 'https://gateway.example/git/coop/app.git/info/refs?service=git-upload-pack',
      method: 'GET',
      authorization: 'basic eC1hY2Nlc3MtdG9rZW46YnNqXzE=',
    });
  });
});
