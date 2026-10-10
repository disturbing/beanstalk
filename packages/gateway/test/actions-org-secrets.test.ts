import { env } from 'cloudflare:test';
import { exports } from 'cloudflare:workers';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { RunSummary } from '@gitstalk/shared-race/actions';
import type { RepositoryRecord } from '@gitstalk/shared-race/repos';
import type { RpcResult } from '@gitstalk/shared-race/rpc';
import { createOrg } from '@gitstalk/shared-identity/org-admin';
import { answerOrgInvitation, inviteToOrg } from '@gitstalk/shared-identity/org-members';
import type { OrgRole } from '@gitstalk/shared-identity/orgs';
import { PersonalTokenInput, createPersonalToken } from '@gitstalk/shared-identity/user-tokens';
import { insertUser } from '@gitstalk/shared-identity/users';

import { call, pkt, sha } from './helpers';

/**
 * Org secrets and variables end to end on Miniflare (doc 25 §3.11). The org `sec-org` has an
 * owner, an admin and a member (lane O's org registry). A push to two org repositories runs a workflow on the stub executor: the org
 * secret selected for `app` reaches only `app` (masked), the repository's own `SHARED` wins
 * over the org's, and `vars.REGION` prints.
 */
const gateway = exports.default;
const actions = exports.Actions;
const ZERO = '0'.repeat(40);

type Person = { readonly id: string; readonly handle: string; readonly token: string };

const WORKFLOW = `name: Secrets
on:
  push:
    branches: [main]
jobs:
  show:
    runs-on: ubuntu-latest
    steps:
      - run: |
          echo org token [\${{ secrets.ORG_TOKEN }}]
          echo shared [\${{ secrets.SHARED }}]
          echo region [\${{ vars.REGION }}]
`;

let org: Person;
let admin: Person;
let member: Person;
let outsider: Person;
let app: RepositoryRecord;
let other: RepositoryRecord;

beforeAll(async () => {
  org = await signUp('sec-owner');
  admin = await signUp('sec-admin');
  member = await signUp('sec-member');
  outsider = await signUp('sec-outsider');
  const created = await createOrg(env, org, { handle: 'sec-org', name: 'Sec org' }, Date.now());
  if (!created.ok) throw new Error(created.error.message);
  await join(created.value.id, admin, 'admin');
  await join(created.value.id, member, 'member');
  app = await createRepo('app');
  other = await createRepo('other');
});

describe('org settings access', () => {
  it('lets owners and admins manage, members read, and hides the org from outsiders', async () => {
    expect(
      await actions.putOrgSecret(member.id, 'sec-org', {
        name: 'NOPE',
        value: 'x-value',
        access: { kind: 'all' },
        prelandAllowed: false,
      }),
    ).toMatchObject({ ok: false, error: { status: 403 } });
    expect(await actions.orgActionsSettings(outsider.id, 'sec-org')).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    expect(await actions.orgActionsSettings(null, 'sec-org')).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    const read = value(await actions.orgActionsSettings(member.id, 'sec-org'));
    expect(read).toMatchObject({ canManage: false, audit: [] });
    expect(read.repositories.map((repo) => repo.name).toSorted()).toEqual(['app', 'other']);
  });
});

describe('an org secret, a repository override and a variable reach a workflow', () => {
  let appRun: RunSummary;
  let otherRun: RunSummary;

  beforeAll(async () => {
    value(
      await actions.putOrgSecret(admin.id, 'sec-org', {
        name: 'org_token',
        value: 'org-token-value-123',
        access: { kind: 'selected', repoIds: [app.id] },
        prelandAllowed: false,
      }),
    );
    value(
      await actions.putOrgSecret(admin.id, 'sec-org', {
        name: 'SHARED',
        value: 'org-shared-value',
        access: { kind: 'all' },
        prelandAllowed: false,
      }),
    );
    value(
      await actions.putOrgVariable(admin.id, 'sec-org', {
        name: 'REGION',
        value: 'eu-west',
        access: { kind: 'all' },
      }),
    );
    // Two characters: too short to be masked, so the log shows whose value won.
    value(
      await actions.putSecret(org.id, app.id, {
        name: 'SHARED',
        value: 'R1',
        prelandAllowed: false,
      }),
    );
    appRun = await pushAndRun(app);
    otherRun = await pushAndRun(other);
  });

  it('gives the selected repository the org secret masked, and its own SHARED over the org’s', async () => {
    const text = await jobLog(appRun);
    expect(text).toContain('org token [***]');
    expect(text).toContain('shared [R1]');
    expect(text).not.toContain('org-token-value-123');
    expect(text).not.toContain('org-shared-value');
  });

  it('gives a repository that is not selected no org token, but the org’s SHARED masked', async () => {
    const text = await jobLog(otherRun);
    expect(text).toContain('org token []');
    expect(text).toContain('shared [***]');
    expect(text).not.toContain('org-shared-value');
  });

  it('prints vars.REGION from the org in both', async () => {
    expect(await jobLog(appRun)).toContain('region [eu-west]');
    expect(await jobLog(otherRun)).toContain('region [eu-west]');
  });

  it('shows the repository its own and inherited entries, names only, with their source', async () => {
    const entries = value(await actions.repoActionsEntries(org.id, app.id));
    expect(entries.orgHandle).toBe('sec-org');
    expect(
      entries.secrets.map((secret) => [secret.name, secret.source.kind, secret.overridden]),
    ).toEqual([
      ['SHARED', 'repository', false],
      ['ORG_TOKEN', 'organization', false],
      ['SHARED', 'organization', true],
    ]);
    expect(JSON.stringify(entries)).not.toContain('org-token-value-123');
    expect(entries.variables).toEqual([
      expect.objectContaining({
        name: 'REGION',
        value: 'eu-west',
        source: { kind: 'organization', orgHandle: 'sec-org' },
      }),
    ]);
    const otherEntries = value(await actions.repoActionsEntries(org.id, other.id));
    expect(otherEntries.secrets.map((secret) => secret.name)).toEqual(['SHARED']);
  });

  it('audits org changes by name and policy, never by value', async () => {
    const settings = value(await actions.orgActionsSettings(admin.id, 'sec-org'));
    expect(settings.canManage).toBe(true);
    expect(settings.audit.map((line) => [line.action, line.actorHandle])).toEqual(
      expect.arrayContaining([
        ['org-secret-set', 'sec-admin'],
        ['org-variable-set', 'sec-admin'],
      ]),
    );
    expect(settings.audit.map((line) => line.detail)).toContain(
      'ORG_TOKEN · selected: 1 repository',
    );
    expect(JSON.stringify(settings)).not.toContain('org-token-value-123');
    expect(settings.secrets.find((secret) => secret.name === 'ORG_TOKEN')?.access).toEqual({
      kind: 'selected',
      repoIds: [app.id],
    });
  });

  it('deletes an org secret and audits it', async () => {
    value(
      await actions.putOrgSecret(admin.id, 'sec-org', {
        name: 'TEMP',
        value: 'temp-value',
        access: { kind: 'private' },
        prelandAllowed: true,
      }),
    );
    expect(value(await actions.deleteOrgSecret(admin.id, 'sec-org', 'temp'))).toEqual({
      deleted: true,
    });
    const settings = value(await actions.orgActionsSettings(admin.id, 'sec-org'));
    expect(settings.secrets.map((secret) => secret.name)).not.toContain('TEMP');
    expect(settings.audit[0]).toMatchObject({ action: 'org-secret-deleted', detail: 'TEMP' });
  });
});

describe('repository variables', () => {
  it('lets the owner set variables, audits them, and lets readers with a role see names only', async () => {
    value(await actions.putVariable(org.id, other.id, { name: 'stage', value: 'beta' }));
    const people = value(await gateway.repositoryPeople(other.id, org.id));
    expect(people.audit).toContainEqual(
      expect.objectContaining({ action: 'actions-variable-set', detail: 'STAGE' }),
    );
    expect(
      await actions.putVariable(outsider.id, other.id, { name: 'X', value: 'y' }),
    ).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    expect(await actions.repoActionsEntries(outsider.id, other.id)).toMatchObject({
      ok: false,
      error: { status: 404 },
    });
    expect(value(await actions.deleteVariable(org.id, other.id, 'stage'))).toEqual({
      deleted: true,
    });
  });
});

async function pushAndRun(record: RepositoryRecord): Promise<RunSummary> {
  const pushed = await pushFiles(record, 'bean/add-secrets', {
    '.github/workflows/secrets.yml': WORKFLOW,
  });
  expect(pushed.status).toBe(200);
  return vi.waitFor(
    async () => {
      const [first] = value(await actions.listRuns(org.id, record.id, {})).runs;
      if (first?.status !== 'completed') throw new Error('no completed run yet');
      return first;
    },
    { timeout: 20_000, interval: 100 },
  );
}

async function jobLog(run: RunSummary): Promise<string> {
  const detail = value(await actions.getRun(org.id, run.id));
  const [job] = detail.jobs;
  if (job === undefined) throw new Error('no job');
  const page = value(await actions.logChunks(org.id, run.id, job.id));
  return page.chunks.flatMap((chunk) => chunk.lines.map((line) => line.text)).join('\n');
}

async function createRepo(name: string): Promise<RepositoryRecord> {
  return value(
    await gateway.createRepository(org, {
      owner: 'sec-org',
      name,
      visibility: 'private',
      start: { kind: 'empty' },
    }),
  );
}

/** `who` joins the org with `role` (an invitation from its owner, accepted). */
async function join(orgId: string, who: Person, role: OrgRole): Promise<void> {
  const invitation = await inviteToOrg(
    env,
    { actor: org, orgId, invite: { handle: who.handle, role } },
    Date.now(),
  );
  if (!invitation.ok) throw new Error(invitation.error.message);
  const answered = await answerOrgInvitation(
    env,
    { user: who, invitationId: invitation.value.id, answer: 'accept' },
    Date.now(),
  );
  if (!answered.ok) throw new Error(answered.error.message);
}

async function pushFiles(
  record: RepositoryRecord,
  branch: string,
  files: Record<string, string>,
): Promise<Response> {
  const head = await sha(`${record.id}:${branch}`);
  const commits = { [head]: { message: `Add ${branch}`, parents: [], files } };
  const body = `${pkt(`${ZERO} ${head} refs/heads/${branch}\0report-status side-band-64k\n`)}0000PACK${JSON.stringify({ commits })}`;
  return call('POST', `/git/${record.owner.handle}/${record.name}.git/git-receive-pack`, {
    token: org.token,
    body,
    headers: {
      'content-type': 'application/x-git-receive-pack-request',
      accept: 'application/x-git-receive-pack-result',
    },
  });
}

async function signUp(handle: string): Promise<Person> {
  const id = `u_${handle.replace(/-/g, '_')}`;
  await insertUser(env, { id, handle, email: null }, Date.now()).run();
  const pat = await createPersonalToken(env, {
    userId: id,
    request: PersonalTokenInput.parse({ name: 'laptop', scopes: ['read', 'write'], days: 7 }),
  });
  return { id, handle, token: pat.token };
}

function value<T>(result: RpcResult<T>): T {
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}
