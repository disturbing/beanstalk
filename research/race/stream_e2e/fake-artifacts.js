// The Artifacts binding for the streaming-diffs end-to-end loop (devstack.py): the RPC surface
// the gateway uses, backed by remotes.py's admin API over real bare repos, so the driver's
// real git clones and pushes go through the real gateway proxy. Local development only.
import { RpcTarget, WorkerEntrypoint } from 'cloudflare:workers';

const NAMESPACE = 'beanstalk-race';

function artifactsError(code, message) {
  const error = new Error(message);
  error.name = 'ArtifactsError';
  error.code = code;
  return error;
}

async function admin(env, call, params) {
  const url = new URL(`/__admin/${call}`, env.GIT_SERVER);
  for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, String(value));
  return fetch(url, { method: call === 'create' || call === 'delete' ? 'POST' : 'GET' });
}

async function adminJson(env, call, params) {
  const response = await admin(env, call, params);
  if (response.status === 404) throw artifactsError('NOT_FOUND', `${call}: not found`);
  if (!response.ok) throw artifactsError('INTERNAL_ERROR', `${call}: ${response.status}`);
  return response.json();
}

function describe(env, name) {
  const now = new Date(0).toISOString();
  return {
    id: name,
    name,
    description: null,
    defaultBranch: 'main',
    createdAt: now,
    updatedAt: now,
    lastPushAt: null,
    source: null,
    readOnly: false,
    remote: `${env.GIT_SERVER}/git/${NAMESPACE}/${name}.git`,
  };
}

class LocalRepo extends RpcTarget {
  #env;
  #name;

  constructor(env, name) {
    super();
    this.#env = env;
    this.#name = name;
  }

  async info() {
    return describe(this.#env, this.#name);
  }

  async createToken(scope = 'write', ttl = 86400) {
    const expires = Math.floor(Date.now() / 1000) + ttl;
    return {
      id: crypto.randomUUID(),
      plaintext: `art_v1_local_${crypto.randomUUID().replaceAll('-', '')}?expires=${expires}`,
      scope,
      expiresAt: new Date(expires * 1000).toISOString(),
    };
  }

  async log(options = {}) {
    return adminJson(this.#env, 'log', {
      name: this.#name,
      ref: options.ref ?? 'main',
      limit: options.limit ?? 50,
      offset: options.offset ?? 0,
    });
  }

  async readCommit(hash) {
    return adminJson(this.#env, 'commit', { name: this.#name, hash });
  }

  async readTree(hash) {
    return adminJson(this.#env, 'tree', { name: this.#name, hash });
  }

  async readBlob(hash) {
    const response = await admin(this.#env, 'blob', { name: this.#name, hash });
    return response.ok ? new Blob([await response.arrayBuffer()]) : null;
  }

  async readFile({ ref, path }) {
    const response = await admin(this.#env, 'file', { name: this.#name, ref, path });
    return response.ok ? new Blob([await response.arrayBuffer()]) : null;
  }

  async listTokens() {
    return { tokens: [], total: 0 };
  }

  async revokeToken() {
    return true;
  }
}

export class LocalArtifacts extends WorkerEntrypoint {
  async create(name) {
    const response = await admin(this.env, 'create', { name, branch: 'main' });
    if (response.status === 409) throw artifactsError('ALREADY_EXISTS', `${name} exists`);
    if (!response.ok) throw artifactsError('INTERNAL_ERROR', `create ${name}: ${response.status}`);
    return { ...describe(this.env, name), token: 'art_v1_local_create' };
  }

  async get(name) {
    const names = await adminJson(this.env, 'list');
    if (!names.includes(name)) throw artifactsError('NOT_FOUND', `${name} not found`);
    return new LocalRepo(this.env, name);
  }

  async delete(name) {
    return (await admin(this.env, 'delete', { name })).ok;
  }

  async list() {
    const names = await adminJson(this.env, 'list');
    return { repos: names.map((name) => describe(this.env, name)), total: names.length };
  }

  async import() {
    throw artifactsError('REMOTE_AUTH_REQUIRED', 'imports are not available locally');
  }
}

export default { fetch: () => new Response('local artifacts', { status: 200 }) };
