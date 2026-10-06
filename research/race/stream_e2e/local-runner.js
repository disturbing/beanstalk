// The RUNNER binding for the streaming-diffs loop (devstack.py): each runner instance forwards
// the runner API (/v1/squash, /v1/revert, /v1/update-ref, /v1/check) to remotes.py, which does
// the git work for real on the local repos (checks always green). Local development only.
import { DurableObject } from 'cloudflare:workers';

export class LocalRunner extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    return fetch(`${this.env.GIT_SERVER}/__runner${url.pathname}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: await request.text(),
    });
  }
}

export default { fetch: () => new Response('local runner', { status: 200 }) };
