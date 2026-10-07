// A stand-in for the Artifacts binding (the RPC surface the gateway uses) and for the git
// remotes it hands out. Tests only: Artifacts has no local simulator. Repos live in module
// memory of this auxiliary worker; every test uses fresh run ids, so names never collide.
import { RpcTarget, WorkerEntrypoint } from 'cloudflare:workers';

const HOST = 'https://acct.artifacts.test';
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const PERSON = { name: 'fake', email: 'fake@beanstalk.invalid' };
const NAMESPACE = 'beanstalk-race';
const repos = new Map();
const counter = { tokens: 0 };

function artifactsError(code, message) {
  const error = new Error(message);
  error.name = 'ArtifactsError';
  error.code = code;
  return error;
}

function newRepo(name, refs = new Map(), defaultBranch = 'main') {
  const repo = {
    name,
    remote: `${HOST}/git/${NAMESPACE}/${name}.git`,
    refs,
    defaultBranch,
    files: new Map(),
    tokens: [],
    // Git objects of pushes that carried a test payload: commits, trees and blobs by id.
    commits: new Map(),
    trees: new Map(),
    blobs: new Map(),
  };
  repos.set(name, repo);
  return repo;
}

function describe(repo) {
  const now = new Date(0).toISOString();
  return {
    id: repo.name,
    name: repo.name,
    description: null,
    defaultBranch: repo.defaultBranch,
    createdAt: now,
    updatedAt: now,
    lastPushAt: null,
    source: null,
    readOnly: false,
    remote: repo.remote,
  };
}

function branchRef(ref) {
  return ref.startsWith('refs/') ? ref : `refs/heads/${ref}`;
}

class FakeRepo extends RpcTarget {
  #repo;

  constructor(repo) {
    super();
    this.#repo = repo;
  }

  async info() {
    return describe(this.#repo);
  }

  async createToken(scope = 'write', ttl = 86400) {
    counter.tokens += 1;
    const expires = Math.floor(Date.now() / 1000) + ttl;
    // The scope is visible in fake tokens only, so tests can see which scope a job got.
    const plaintext = `art_v1_${scope}_${counter.tokens.toString(16).padStart(32, '0')}?expires=${expires}`;
    this.#repo.tokens.push({ scope, plaintext });
    return {
      id: `token-${counter.tokens}`,
      plaintext,
      scope,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async fork(target, options = {}) {
    if (repos.has(target)) throw artifactsError('ALREADY_EXISTS', `${target} exists`);
    const keep = (ref) =>
      options.defaultBranchOnly === false
        ? ref.startsWith('refs/heads/')
        : ref === branchRef(this.#repo.defaultBranch);
    const fork = newRepo(
      target,
      new Map([...this.#repo.refs].filter(([ref]) => keep(ref))),
      this.#repo.defaultBranch,
    );
    return { ...describe(fork), token: 'art_v1_fork' };
  }

  async log(options = {}) {
    const start = resolveRef(this.#repo, options.ref ?? this.#repo.defaultBranch);
    if (start === undefined) return [];
    const history = [];
    let sha = start;
    while (sha !== undefined && history.length < (options.limit ?? 50) + (options.offset ?? 0)) {
      const commit = this.#repo.commits.get(sha);
      history.push(metadata(sha, commit));
      sha = commit?.parents[0];
    }
    return history.slice(options.offset ?? 0);
  }

  async readFile({ ref, path }) {
    const sha = resolveRef(this.#repo, ref);
    const stored = this.#repo.files.get(`${ref}\0${path}`);
    const content = stored ?? this.#repo.commits.get(sha ?? '')?.files[path];
    return content === undefined ? null : new Blob([content], { type: 'text/plain;charset=utf-8' });
  }

  async readBlob(hash) {
    const content = this.#repo.blobs.get(hash);
    return content === undefined ? null : new Blob([content]);
  }

  async readTree(hash) {
    return this.#repo.trees.get(hash) ?? null;
  }

  async readCommit(hash) {
    const commit = this.#repo.commits.get(hash);
    return commit === undefined ? null : metadata(hash, commit);
  }

  async listTokens() {
    return { tokens: [], total: this.#repo.tokens.length };
  }

  async revokeToken() {
    return true;
  }
}

export class FakeArtifacts extends WorkerEntrypoint {
  async create(name, options = {}) {
    if (repos.has(name)) throw artifactsError('ALREADY_EXISTS', `${name} exists`);
    const repo = newRepo(name, new Map(), options.setDefaultBranch ?? 'main');
    return { ...describe(repo), token: 'art_v1_create' };
  }

  async get(name) {
    const repo = repos.get(name);
    if (repo === undefined) throw artifactsError('NOT_FOUND', `${name} not found`);
    return new FakeRepo(repo);
  }

  async delete(name) {
    return repos.delete(name);
  }

  async list() {
    return { repos: [...repos.values()].map(describe), total: repos.size };
  }

  // Imports are faked for one URL shape: https://git.example.test/<anything>.git gives a repo
  // with one commit on `main` holding a README and a source file; anything else needs auth.
  async import({ source, target }) {
    if (!source.url.startsWith('https://git.example.test/'))
      throw artifactsError('REMOTE_AUTH_REQUIRED', 'imports are not faked for this URL');
    if (repos.has(target.name)) throw artifactsError('ALREADY_EXISTS', `${target.name} exists`);
    const repo = newRepo(target.name, new Map(), 'main');
    const files = { 'README.md': '# imported\n', 'src/index.ts': 'export {};\n' };
    const sha = objectId(`commit:${source.url}`);
    repo.commits.set(sha, { parents: [], message: 'imported', time: 0, files, tree: storeTree(repo, files) });
    repo.refs.set('refs/heads/main', sha);
    return { ...describe(repo), token: 'art_v1_import' };
  }
}

function resolveRef(repo, ref) {
  return /^[0-9a-f]{40}$/.test(ref) ? ref : repo.refs.get(branchRef(ref));
}

function metadata(hash, commit) {
  return {
    hash,
    treeHash: commit?.tree ?? hash,
    message: commit?.message ?? '',
    author: PERSON,
    committer: PERSON,
    parents: commit?.parents ?? [],
    authoredAt: commit?.time ?? 0,
    committedAt: commit?.time ?? 0,
  };
}

/** A 40-hex id for an object's content (FNV-1a, five seeds): stable, like git's. */
function objectId(text) {
  let out = '';
  for (let seed = 0; seed < 5; seed += 1) {
    let hash = (0x811c9dc5 ^ seed) >>> 0;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    out += hash.toString(16).padStart(8, '0');
  }
  return out;
}

/** Stores the tree of a file map (and its blobs and subtrees); returns the root tree id. */
function storeTree(repo, files) {
  const children = new Map();
  for (const [path, content] of Object.entries(files)) {
    const [head, ...rest] = path.split('/');
    if (rest.length === 0) {
      const blob = objectId(`blob:${content}`);
      repo.blobs.set(blob, content);
      children.set(head, { name: head, mode: '100644', hash: blob, type: 'blob' });
      continue;
    }
    const sub = children.get(head)?.files ?? {};
    sub[rest.join('/')] = content;
    children.set(head, { name: head, files: sub });
  }
  const entries = [...children.values()]
    .map((child) =>
      child.files === undefined
        ? child
        : { name: child.name, mode: '40000', hash: storeTree(repo, child.files), type: 'tree' },
    )
    .toSorted((a, b) => (a.name < b.name ? -1 : 1));
  const id = entries.length === 0 ? EMPTY_TREE : objectId(`tree:${JSON.stringify(entries)}`);
  repo.trees.set(id, entries);
  return id;
}

/** A test-only pack: JSON after `PACK` describing commits (`{commits: {sha: {parents, files}}}`). */
function storePayload(repo, bytes) {
  const text = new TextDecoder().decode(bytes);
  const at = text.indexOf('0000PACK');
  const payload = at < 0 ? '' : text.slice(at + '0000PACK'.length);
  if (!payload.startsWith('{')) return;
  for (const [sha, commit] of Object.entries(JSON.parse(payload).commits ?? {})) {
    const files = commit.files ?? {};
    repo.commits.set(sha, {
      parents: commit.parents ?? [],
      message: commit.message ?? '',
      time: commit.time ?? 0,
      files,
      tree: storeTree(repo, files),
    });
  }
}

/** Commands at the head of a receive-pack body: `<old> <new> <ref>` pkt-lines up to a flush. */
function pushCommands(bytes) {
  const text = new TextDecoder().decode(bytes);
  const commands = [];
  let offset = 0;
  while (offset + 4 <= text.length) {
    const length = Number.parseInt(text.slice(offset, offset + 4), 16);
    if (length === 0) break;
    const line = text
      .slice(offset + 4, offset + length)
      .split('\0')[0]
      .replace(/\n$/, '');
    const [oldSha, newSha, ref] = line.split(' ');
    commands.push({ oldSha, newSha, ref });
    offset += length;
  }
  return commands;
}

// The git remotes (every outbound fetch of the gateway lands here in tests): pushes update
// refs; every request is echoed back so tests can see what the proxy forwarded.
export class FakeGitRemote extends WorkerEntrypoint {
  async fetch(request) {
    const url = new URL(request.url);
    const match = /^\/git\/([^/]+)\/([^/]+)\.git\/(.+)$/.exec(url.pathname);
    const repo = match === null ? undefined : repos.get(match[2]);
    if (repo === undefined) return new Response('no such repo', { status: 404 });
    const authorization = request.headers.get('authorization') ?? '';
    const token = authorization.replace(/^Bearer /, '');
    if (!repo.tokens.some((issued) => issued.plaintext === token))
      return new Response('bad token', { status: 401 });
    const bytes = new Uint8Array(await request.arrayBuffer());
    const commands = match[3] === 'git-receive-pack' ? pushCommands(bytes) : [];
    for (const command of commands) repo.refs.set(command.ref, command.newSha);
    if (commands.length > 0) storePayload(repo, bytes);
    return Response.json(
      {
        method: request.method,
        path: url.pathname,
        query: url.search,
        authorization: authorization.slice(0, 'Bearer art_v1_'.length),
        scope: repo.tokens.find((issued) => issued.plaintext === token)?.scope ?? null,
        gitProtocol: request.headers.get('git-protocol'),
        bytes: bytes.length,
        commands,
      },
      { headers: { 'www-authenticate': 'Basic realm="artifacts"', 'x-upstream': 'fake' } },
    );
  }
}
