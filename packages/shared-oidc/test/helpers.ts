import type { IdTokenJob } from '../src/job-identity';
import type { OidcConfig } from '../src/issuer';
import { createOidcApp } from '../src/issuer';
import type { SigningAlgorithm } from '../src/signing-keys';
import { generateSigningKey, loadSigningKeys } from '../src/signing-keys';

export const ISSUER = 'https://beanstalk.example/_actions/oidc';
export const REQUEST_SECRET = 'test-request-secret-0123456789abcdef0123';
export const NOW_MS = Date.UTC(2026, 9, 8, 12, 0, 0);
const SHA = 'a'.repeat(40);

export function stalkJob(overrides: Partial<IdTokenJob> = {}): IdTokenJob {
  return {
    jobId: 'job-1',
    runId: 'run-1',
    runNumber: 7,
    runAttempt: 1,
    repository: {
      id: 'repo-1',
      owner: 'acme',
      ownerId: 'own-1',
      name: 'site',
      visibility: 'private',
    },
    workflowPath: '.github/workflows/deploy.yml',
    workflowName: 'Deploy',
    workflowRef: 'refs/heads/stalk',
    actor: 'coop',
    actorId: 'usr-1',
    idTokenWrite: true,
    run: { kind: 'stalk', event: 'push', ref: 'refs/heads/stalk', sha: SHA },
    ...overrides,
  };
}

export function prelandJob(
  pusher: 'maintainer' | 'collaborator' | 'agent' | 'deploy_token',
): IdTokenJob {
  return stalkJob({
    run: { kind: 'preland', bean: 'fix-nav', pusher, baseRef: 'main', sha: 'b'.repeat(40) },
  });
}

export async function keySetJson(
  algs: readonly SigningAlgorithm[],
  activeIndex = 0,
): Promise<string> {
  const keys = await Promise.all(
    algs.map((alg, index) => generateSigningKey(alg, `kid-${index}-${alg}`)),
  );
  return JSON.stringify({ active: keys[activeIndex]?.kid, keys });
}

export async function makeConfig(
  keySet: string,
  overrides: Partial<OidcConfig> = {},
): Promise<OidcConfig> {
  return {
    issuerUrl: ISSUER,
    keys: await loadSigningKeys(keySet),
    requestSecrets: { current: REQUEST_SECRET },
    nowMs: () => NOW_MS,
    ...overrides,
  };
}

/** The app mounted where a Worker mounts it, so URLs match what a job sees. */
export function appFor(config: OidcConfig) {
  return createOidcApp(() => Promise.resolve(config));
}

export function pathOf(url: string): string {
  return new URL(url).pathname.replace('/_actions/oidc', '') + new URL(url).search;
}
