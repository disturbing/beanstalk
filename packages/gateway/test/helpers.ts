import { SELF } from 'cloudflare:test';

export const ADMIN = 'test-admin-token';
export const ORIGIN = 'https://gateway.test';
export const NAMESPACE = 'beanstalk-race';
export const ZERO_SHA = '0'.repeat(40);

/** A task in the arena file format. */
export function arenaTask(id: string): Record<string, unknown> {
  return {
    id,
    title: `Task ${id}`,
    prompt: `Implement ${id}.`,
    acceptance_tests: { [`tests/${id}.test.ts`]: `test('${id}');\n` },
    oracle_paths: [`src/${id}.ts`],
    oracle_modules: ['src'],
    kind: 'feature',
    difficulty: 1,
    couplings: [],
  };
}

export type CreatedRun = {
  run: string;
  repo: { name: string; url: string; sprout: string; stalk: string };
  slots: { slot: string; token: string; expires_at: string }[];
  view: { token: string; live_url: string; events_url: string };
};

export async function call(
  method: string,
  path: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.token !== undefined) headers.set('authorization', `Bearer ${options.token}`);
  if (options.body !== undefined && typeof options.body !== 'string')
    headers.set('content-type', 'application/json');
  const body =
    options.body === undefined || typeof options.body === 'string'
      ? options.body
      : JSON.stringify(options.body);
  return SELF.fetch(`${ORIGIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

export async function json<T>(response: Response): Promise<T> {
  try {
    return await response.clone().json<T>();
  } catch {
    throw new Error(`not JSON (${response.status}): ${await response.text()}`);
  }
}

/** Creates a queue run with the given tasks (defaults: replay agents, no CI latency). */
export async function createRun(config: Record<string, unknown> = {}): Promise<CreatedRun> {
  const response = await call('POST', '/v1/runs', {
    token: ADMIN,
    body: {
      policy: 'queue',
      agents: 2,
      ci_seconds: 0,
      tasks: [arenaTask('t001'), arenaTask('t002')],
      ...config,
    },
  });
  if (response.status !== 201)
    throw new Error(`create failed: ${response.status} ${await response.text()}`);
  return json<CreatedRun>(response);
}

export function slotToken(run: CreatedRun, slot: string): string {
  const entry = run.slots.find((candidate) => candidate.slot === slot);
  if (entry === undefined) throw new Error(`no slot ${slot}`);
  return entry.token;
}

/** One pkt-line (length prefix included in the length). */
export function pkt(line: string): string {
  return `${(line.length + 4).toString(16).padStart(4, '0')}${line}`;
}

/** A receive-pack request body updating one ref (an empty pack follows the commands). */
export function pushBody(ref: string, newSha: string, oldSha = ZERO_SHA): string {
  return pushRefsBody([{ ref, newSha, oldSha }]);
}

/** A receive-pack body updating several refs in one push (capabilities on the first line). */
export function pushRefsBody(
  updates: readonly { ref: string; newSha: string; oldSha?: string }[],
): string {
  const lines = updates.map(({ ref, newSha, oldSha = ZERO_SHA }, index) =>
    pkt(`${oldSha} ${newSha} ${ref}${index === 0 ? '\0report-status' : ''}\n`),
  );
  return `${lines.join('')}0000PACK`;
}

export function gitPath(repo: string, rest: string): string {
  return `/git/${NAMESPACE}/${repo}.git/${rest}`;
}

/** A commit a test push carries (the fake remote stores it; real git would send a pack). */
export type FakeCommit = { parents?: string[]; message?: string; files: Record<string, string> };

/** Pushes refs with the seed token, carrying commits the fake Artifacts can read back. */
export async function pushCommits(
  run: CreatedRun,
  refs: Record<string, string>,
  commits: Record<string, FakeCommit>,
): Promise<Response> {
  const tokenResponse = await call('POST', `/v1/runs/${run.run}/seed-token`, { token: ADMIN });
  const { token } = await json<{ token: string }>(tokenResponse);
  const updates = Object.entries(refs).map(([ref, newSha]) => ({ ref, newSha }));
  return call('POST', gitPath(run.repo.name, 'git-receive-pack'), {
    token,
    body: `${pushRefsBody(updates)}${JSON.stringify({ commits })}`,
    headers: { 'content-type': 'application/x-git-receive-pack-request' },
  });
}

/** Seeds the run repo with the admin's seed token: the base goes to the sprout and the stalk. */
export async function pushBase(
  run: CreatedRun,
  baseSha: string,
  refs: readonly string[] = ['refs/heads/sprout', 'refs/heads/stalk'],
): Promise<Response> {
  const tokenResponse = await call('POST', `/v1/runs/${run.run}/seed-token`, { token: ADMIN });
  const { token } = await json<{ token: string }>(tokenResponse);
  return call('POST', gitPath(run.repo.name, 'git-receive-pack'), {
    token,
    body: pushRefsBody(refs.map((ref) => ({ ref, newSha: baseSha }))),
    headers: { 'content-type': 'application/x-git-receive-pack-request' },
  });
}
