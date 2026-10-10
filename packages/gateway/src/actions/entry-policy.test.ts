import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

import { SecretName } from '@gitstalk/shared-race/actions';
import { VariableName } from '@gitstalk/shared-race/actions-secrets';

import { effectiveOnly, policyReaches, resolveEntries } from './entry-policy';
import { maskTermsOf, maskText } from './mask';
import { staticOrgDirectory } from './org-directory';
import { d1OrgSecrets } from './org-secrets';
import { jobSecretCatalog, jobVariables } from './repo-entries';
import type { EntryStores } from './repo-entries';
import { d1Secrets, secretsForRun } from './secrets';
import { d1Variables } from './variables';

const PUBLIC_REPO = { id: 'r_pub', visibility: 'public' } as const;
const PRIVATE_REPO = { id: 'r_priv', visibility: 'private' } as const;
const BY = { actor: 'org-admin', at: '2026-10-09T00:00:00.000Z' };

describe('org access policy', () => {
  it('reaches every repository with all, private ones with private, listed ones with selected', () => {
    expect(policyReaches({ kind: 'all' }, PUBLIC_REPO)).toBe(true);
    expect(policyReaches({ kind: 'private' }, PUBLIC_REPO)).toBe(false);
    expect(policyReaches({ kind: 'private' }, PRIVATE_REPO)).toBe(true);
    expect(policyReaches({ kind: 'selected', repoIds: ['r_priv'] }, PRIVATE_REPO)).toBe(true);
    expect(policyReaches({ kind: 'selected', repoIds: ['r_priv'] }, PUBLIC_REPO)).toBe(false);
    expect(policyReaches({ kind: 'selected', repoIds: [] }, PUBLIC_REPO)).toBe(false);
  });
});

describe('precedence', () => {
  it('lets a repository entry win over an org entry of the same name, keeping the org one marked', () => {
    const entries = resolveEntries({
      repo: PRIVATE_REPO,
      repoEntries: [{ name: 'TOKEN', value: 'repo' }],
      orgEntries: [
        { name: 'TOKEN', value: 'org', access: { kind: 'all' } },
        { name: 'REGION', value: 'org', access: { kind: 'private' } },
        { name: 'HIDDEN', value: 'org', access: { kind: 'selected', repoIds: ['other'] } },
      ],
    });
    expect(entries.map((entry) => [entry.name, entry.from, entry.overridden])).toEqual([
      ['TOKEN', 'repository', false],
      ['REGION', 'organization', false],
      ['TOKEN', 'organization', true],
    ]);
    expect(effectiveOnly(entries).map((entry) => [entry.name, entry.value])).toEqual([
      ['TOKEN', 'repo'],
      ['REGION', 'org'],
    ]);
  });
});

describe('org secrets for jobs', () => {
  const key = Reflect.get(env, 'ACTIONS_SECRETS_KEY');
  const keyText = typeof key === 'string' ? key : null;
  const stores: EntryStores = {
    secrets: d1Secrets(env.FORGE, keyText),
    orgSecrets: d1OrgSecrets(env.FORGE, keyText),
    variables: d1Variables(env.FORGE),
    orgs: staticOrgDirectory([{ id: 'org_unit', handle: 'unit-org', members: {} }]),
  };
  const orgRepo = (id: string, visibility: 'public' | 'private') => ({
    id,
    visibility,
    owner: { id: 'org_unit', handle: 'unit-org' },
  });

  it('stores org secrets sealed, bound to their org, and lists names and policies only', async () => {
    await stores.orgSecrets.put(
      'org_unit',
      {
        name: SecretName.parse('ORG_DEPLOY'),
        value: 'org-deploy-value',
        access: { kind: 'selected', repoIds: ['r_one'] },
        prelandAllowed: false,
      },
      BY,
    );
    const row = await env.FORGE.prepare(
      'SELECT ciphertext FROM actions_org_secrets WHERE org_id = ? AND name = ?',
    )
      .bind('org_unit', 'ORG_DEPLOY')
      .first<{ ciphertext: string }>();
    expect(row?.ciphertext).not.toContain('org-deploy-value');
    const listed = await stores.orgSecrets.list('org_unit');
    expect(listed).toContainEqual(
      expect.objectContaining({
        name: 'ORG_DEPLOY',
        access: { kind: 'selected', repoIds: ['r_one'] },
      }),
    );
    expect(JSON.stringify(listed)).not.toContain('org-deploy-value');
    // A row copied to another org does not decrypt there.
    await env.FORGE.prepare(
      `INSERT INTO actions_org_secrets (org_id, name, ciphertext, iv, key_version, access, preland_allowed, updated_at, updated_by)
       SELECT 'o_thief', name, ciphertext, iv, key_version, access, preland_allowed, updated_at, updated_by
       FROM actions_org_secrets WHERE org_id = 'org_unit' AND name = 'ORG_DEPLOY'`,
    ).run();
    await expect(stores.orgSecrets.reveal('o_thief', ['ORG_DEPLOY'])).rejects.toThrow();
  });

  it('changes the policy and pre-land toggle without the value, and refuses that for a new name', async () => {
    const kept = await stores.orgSecrets.put(
      'org_unit',
      {
        name: SecretName.parse('ORG_DEPLOY'),
        value: null,
        access: { kind: 'selected', repoIds: ['r_one', 'r_two'] },
        prelandAllowed: false,
      },
      BY,
    );
    expect(kept?.access).toEqual({ kind: 'selected', repoIds: ['r_one', 'r_two'] });
    expect(await stores.orgSecrets.reveal('org_unit', ['ORG_DEPLOY'])).toEqual({
      ORG_DEPLOY: 'org-deploy-value',
    });
    expect(
      await stores.orgSecrets.put(
        'org_unit',
        {
          name: SecretName.parse('NEVER_SAVED'),
          value: null,
          access: { kind: 'all' },
          prelandAllowed: false,
        },
        BY,
      ),
    ).toBeNull();
  });

  it('gives a selected repository the org secret, another none, and lets the repository override it', async () => {
    await stores.secrets.put(
      'r_two',
      { name: 'ORG_DEPLOY', value: 'repo-wins-value', prelandAllowed: false },
      BY,
    );
    const selected = await jobSecretCatalog(stores, orgRepo('r_one', 'private'));
    expect(
      await selected.reveal(secretsForRun({ kind: 'stalk' }, ['ORG_DEPLOY'], selected.stored)),
    ).toEqual({
      ORG_DEPLOY: 'org-deploy-value',
    });
    const overriding = await jobSecretCatalog(stores, orgRepo('r_two', 'private'));
    expect(
      await overriding.reveal(secretsForRun({ kind: 'stalk' }, ['ORG_DEPLOY'], overriding.stored)),
    ).toEqual({ ORG_DEPLOY: 'repo-wins-value' });
    const other = await jobSecretCatalog(stores, orgRepo('r_three', 'private'));
    expect(secretsForRun({ kind: 'stalk' }, ['ORG_DEPLOY'], other.stored)).toEqual([]);
  });

  it('applies D4 to org secrets: untrusted pre-land runs get only those toggled on', async () => {
    await stores.orgSecrets.put(
      'org_unit',
      {
        name: SecretName.parse('ORG_TEST_KEY'),
        value: 'low-risk-test-key',
        access: { kind: 'all' },
        prelandAllowed: true,
      },
      BY,
    );
    const catalog = await jobSecretCatalog(stores, orgRepo('r_one', 'private'));
    const named = ['ORG_DEPLOY', 'ORG_TEST_KEY'];
    for (const pushedBy of ['agent-session', 'deploy-token', 'collaborator'] as const)
      expect(secretsForRun({ kind: 'preland', pushedBy }, named, catalog.stored)).toEqual([
        'ORG_TEST_KEY',
      ]);
    expect(
      secretsForRun({ kind: 'preland', pushedBy: 'maintainer' }, named, catalog.stored),
    ).toEqual(named);
    for (const kind of ['stalk', 'dispatch', 'schedule'] as const)
      expect(secretsForRun({ kind }, named, catalog.stored)).toEqual(named);
  });

  it('masks org secret values like repository ones', async () => {
    const catalog = await jobSecretCatalog(stores, orgRepo('r_one', 'private'));
    const values = await catalog.reveal(['ORG_DEPLOY']);
    const terms = maskTermsOf(Object.values(values));
    expect(maskText('deploying with org-deploy-value', terms)).toBe('deploying with ***');
    expect(maskText(btoa('org-deploy-value'), terms)).toBe('***');
  });

  it('gives a job every variable it sees, the repository’s winning, the private policy honoured', async () => {
    await stores.variables.putOrg(
      'org_unit',
      { name: VariableName.parse('REGION'), value: 'org-region', access: { kind: 'all' } },
      BY,
    );
    await stores.variables.putOrg(
      'org_unit',
      {
        name: VariableName.parse('INTERNAL_URL'),
        value: 'https://int',
        access: { kind: 'private' },
      },
      BY,
    );
    await stores.variables.putRepo(
      'r_pubrepo',
      { name: VariableName.parse('REGION'), value: 'repo-region' },
      BY,
    );
    expect(await jobVariables(stores, orgRepo('r_pubrepo', 'public'))).toEqual({
      REGION: 'repo-region',
    });
    expect(await jobVariables(stores, orgRepo('r_one', 'private'))).toEqual({
      INTERNAL_URL: 'https://int',
      REGION: 'org-region',
    });
  });

  it('gives a person’s repository nothing from orgs', async () => {
    const personal = {
      id: 'r_one',
      visibility: 'private' as const,
      owner: { id: 'u_x', handle: 'x' },
    };
    expect(await jobVariables(stores, personal)).toEqual({});
    expect((await jobSecretCatalog(stores, personal)).stored).toEqual([]);
  });
});
