import { describe, expect, it } from 'vitest';

import type { RunSummary } from './actions-contract';
import { PutSecretInput } from './actions-contract';
import type { ActionsClient } from './actions-client';
import { COOP, testActions } from './testing/fake-actions';

const NOON = Date.UTC(2026, 9, 8, 12, 0, 0);

async function value<T>(
  pending: Promise<{ ok: true; value: T } | { ok: false; error: { message: string } }>,
): Promise<T> {
  const result = await pending;
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function latestCiRun(client: ActionsClient): Promise<RunSummary> {
  const page = await value(
    client.runs({ workflow: '.github/workflows/ci.yml', status: 'success', limit: 1 }),
  );
  const run = page.runs[0];
  if (run === undefined) throw new Error('no CI run');
  return run;
}

describe('the fixture control plane through the client', () => {
  it('lists the workflows with their triggers, notes and last runs', async () => {
    const actions = testActions(NOON);
    const workflows = await value(actions.client().workflows());
    expect(workflows.map((workflow) => workflow.name)).toEqual([
      'CI',
      'Deploy',
      'Nightly e2e',
      'Release image',
    ]);
    const image = workflows.find((workflow) => workflow.name === 'Release image');
    expect(image?.lastRun).toBeNull();
    expect(image?.notes[0]?.level).toBe('never');
    expect(workflows.find((workflow) => workflow.name === 'CI')?.lastRun).not.toBeNull();
  });

  it('shows a running job further along each time it is asked, until its log is complete', async () => {
    const actions = testActions(NOON);
    const run = await latestCiRun(actions.client());
    actions.setNow(Date.parse(run.createdAt) + 20_000);
    const early = await value(actions.client().run(run.id));
    expect(early.status).toBe('in_progress');
    expect(early.jobs.find((job) => job.id === 'test')?.status).toBe('queued');
    const first = await value(actions.client().log(run.id, 'lint', 0));
    expect(first.complete).toBe(false);
    actions.advance(5_000);
    const more = await value(actions.client().log(run.id, 'lint', first.lines.at(-1)?.n ?? 0));
    expect(more.lines.length).toBeGreaterThan(0);
    expect(more.lines[0]?.n).toBe((first.lines.at(-1)?.n ?? 0) + 1);
    actions.advance(10 * 60_000);
    const done = await value(actions.client().run(run.id));
    expect(done.status).toBe('completed');
    expect(done.conclusion).toBe('success');
    expect(done.billedMinutes).toBeGreaterThanOrEqual(3);
    expect((await value(actions.client().log(run.id, 'test', 0))).complete).toBe(true);
  });

  it('fails a red CI run in its test step, with the failing test as an annotation', async () => {
    const actions = testActions(NOON);
    const failed = await value(
      actions.client().runs({ workflow: '.github/workflows/ci.yml', status: 'failure', limit: 1 }),
    );
    const run = await value(actions.client().run(failed.runs[0]?.id ?? ''));
    const test = run.jobs.find((job) => job.id === 'test');
    expect(test?.conclusion).toBe('failure');
    expect(test?.steps.find((step) => step.conclusion === 'failure')?.name).toBe('npm test');
    expect(run.annotations).toContainEqual(
      expect.objectContaining({ level: 'error', path: 'test/tax.test.ts', line: 27 }),
    );
    const log = await value(actions.client().log(run.id, 'test', 0));
    expect(log.lines.some((line) => line.text.startsWith('::error file=test/tax.test.ts'))).toBe(
      true,
    );
  });

  it('runs a workflow by hand with its inputs, newest first', async () => {
    const actions = testActions(NOON);
    const started = await value(
      actions.client().dispatch({
        workflow: '.github/workflows/deploy.yml',
        ref: 'stalk',
        inputs: { environment: 'production' },
      }),
    );
    actions.advance(1000);
    const page = await value(actions.client().runs({ limit: 5 }));
    expect(page.runs[0]?.id).toBe(started.runId);
    expect(page.runs[0]?.event).toBe('workflow_dispatch');
    expect(page.runs[0]?.actor).toEqual({ kind: 'person', handle: 'coop' });
    const run = await value(actions.client().run(started.runId));
    expect(run.inputs).toEqual({ environment: 'production' });
    expect(run.canRerun).toBe(true);
  });

  it('cancels a running run once: the running step stops with a cancel line', async () => {
    const actions = testActions(NOON);
    const run = await latestCiRun(actions.client());
    actions.setNow(Date.parse(run.createdAt) + 25_000);
    await value(actions.client().cancel(run.id));
    actions.advance(60_000);
    const after = await value(actions.client().run(run.id));
    expect(after.status).toBe('completed');
    expect(after.conclusion).toBe('cancelled');
    const log = await value(actions.client().log(run.id, 'lint', 0));
    expect(log.lines.at(-1)?.text).toBe('Error: The operation was canceled.');
    const again = await actions.client().cancel(run.id);
    expect(again.ok).toBe(false);
  });

  it('refuses every write from someone signed out', async () => {
    const client = testActions(NOON).client(null);
    const dispatch = await client.dispatch({
      workflow: '.github/workflows/ci.yml',
      ref: 'stalk',
      inputs: {},
    });
    const secret = await client.putSecret({ name: 'X', value: 'v', availableToPreland: false });
    expect(dispatch.ok).toBe(false);
    expect(secret.ok).toBe(false);
  });

  it('keeps secret names, never values, and toggles pre-land access without a value', async () => {
    const actions = testActions(NOON);
    const client = actions.client(COOP);
    await value(
      client.putSecret({
        name: 'SENTRY_DSN',
        value: 'very-secret-value',
        availableToPreland: false,
      }),
    );
    expect(JSON.stringify(actions.overlay())).not.toContain('very-secret-value');
    await value(client.putSecret({ name: 'SENTRY_DSN', value: null, availableToPreland: true }));
    const listed = await value(client.secrets());
    expect(listed.secrets.find((secret) => secret.name === 'SENTRY_DSN')).toMatchObject({
      availableToPreland: true,
      updatedBy: 'coop',
    });
    expect(listed.usage).toMatchObject({ minutesIncluded: 100, jobTimeoutMinutes: 60 });
    await value(client.deleteSecret('SENTRY_DSN'));
    const after = await value(client.secrets());
    expect(after.secrets.some((secret) => secret.name === 'SENTRY_DSN')).toBe(false);
  });

  it('pages runs by a cursor with no run on two pages', async () => {
    const client = testActions(NOON).client();
    const first = await value(client.runs({ limit: 10 }));
    expect(first.next).not.toBeNull();
    const second = await value(client.runs({ limit: 10, before: first.next ?? '' }));
    const ids = new Set(first.runs.map((run) => run.id));
    expect(second.runs.some((run) => ids.has(run.id))).toBe(false);
    const oldestFirst = Date.parse(first.runs.at(-1)?.createdAt ?? '');
    expect(second.runs.every((run) => Date.parse(run.createdAt) <= oldestFirst)).toBe(true);
  });

  it('answers not found for a run it never had', async () => {
    const result = await testActions(NOON).client().run('ci-12');
    expect(result.ok).toBe(false);
  });
});

describe('secret names', () => {
  it('upper-cases a name and refuses reserved or malformed ones', () => {
    expect(
      PutSecretInput.parse({ name: 'npm_token', value: 'x', availableToPreland: false }).name,
    ).toBe('NPM_TOKEN');
    expect(
      PutSecretInput.safeParse({ name: 'GITHUB_TOKEN', value: 'x', availableToPreland: false })
        .success,
    ).toBe(false);
    expect(
      PutSecretInput.safeParse({ name: '9LIVES', value: 'x', availableToPreland: false }).success,
    ).toBe(false);
    expect(
      PutSecretInput.safeParse({ name: 'A-B', value: 'x', availableToPreland: false }).success,
    ).toBe(false);
  });
});
