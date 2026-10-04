/** The two smart-HTTP services git speaks. */
export type GitService = 'git-upload-pack' | 'git-receive-pack';

/** A smart-HTTP request under `/git/<namespace>/<repo>.git/`. */
export type GitPath = {
  readonly namespace: string;
  readonly repo: string;
  /** What follows `<repo>.git/` upstream (`info/refs` or the service). */
  readonly rest: 'info/refs' | GitService;
  readonly service: GitService;
};

export type GitPathParse =
  | { readonly ok: true; readonly path: GitPath }
  | { readonly ok: false; readonly status: 404 | 405; readonly message: string };

const GIT_PATH =
  /^\/git\/([A-Za-z0-9][A-Za-z0-9._-]{0,62})\/([A-Za-z0-9][A-Za-z0-9._-]{0,99})\.git\/(info\/refs|git-upload-pack|git-receive-pack)$/;

function isService(value: string | null): value is GitService {
  return value === 'git-upload-pack' || value === 'git-receive-pack';
}

/**
 * Recognises ref advertisement (`GET info/refs?service=…`) and the service calls
 * (`POST git-upload-pack|git-receive-pack`). The dumb protocol is not served.
 */
export function parseGitPath(url: URL, method: string): GitPathParse {
  const match = GIT_PATH.exec(url.pathname);
  const [, namespace, repo, rest] = match ?? [];
  if (namespace === undefined || repo === undefined || rest === undefined) {
    return { ok: false, status: 404, message: 'not a smart-HTTP git endpoint' };
  }
  if (rest === 'info/refs') {
    const service = url.searchParams.get('service');
    if (!isService(service))
      return { ok: false, status: 404, message: 'only smart HTTP is served' };
    if (method !== 'GET') return { ok: false, status: 405, message: 'info/refs is GET only' };
    return { ok: true, path: { namespace, repo, rest, service } };
  }
  if (!isService(rest)) return { ok: false, status: 404, message: 'unknown git service' };
  if (method !== 'POST') return { ok: false, status: 405, message: `${rest} is POST only` };
  return { ok: true, path: { namespace, repo, rest, service: rest } };
}

/** Pushing needs write access; everything else reads. */
export function accessFor(service: GitService): 'read' | 'write' {
  return service === 'git-receive-pack' ? 'write' : 'read';
}
