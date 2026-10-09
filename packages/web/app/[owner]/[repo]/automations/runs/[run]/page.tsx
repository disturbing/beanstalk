import { notFound } from 'next/navigation';

import { ActionsOff, ActionsShell } from '../../../../../../components/actions/actions-shell';
import { RunView } from '../../../../../../components/actions/run-view';
import { focusJob } from '../../../../../../src/actions/run-view';
import { actionsPage } from '../../../../../../src/server/actions-page';

type PageProps = {
  readonly params: Promise<{ readonly owner: string; readonly repo: string; readonly run: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
};

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo } = await params;
  return { title: `Automation run, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}` };
}

/**
 * One automation run (doc 25 §7.8): what it did (beans, memory, model spend), its graph and
 * the chosen job's log (`?job=`, else the first failed or running job).
 * The run and the job's log so far are read on the server; the log then streams.
 */
export default async function AutomationRunPage({ params, searchParams }: PageProps) {
  const page = await actionsPage(params);
  const { run: runParam } = await params;
  if (page.actions === null)
    return (
      <ActionsShell page={page} view="automations" mode={null}>
        <ActionsOff />
      </ActionsShell>
    );
  const run = await page.actions.run(decodeURIComponent(runParam));
  if (!run.ok) notFound();
  const asked = (await searchParams)['job'];
  const job =
    run.value.jobs.find((candidate) => candidate.id === asked) ?? focusJob(run.value.jobs);
  const lines = job === null ? null : await page.actions.log(run.value.id, job.id, 0);
  return (
    <ActionsShell page={page} view="automations" mode={page.actions.mode}>
      <RunView
        base={page.base}
        apiBase={`/api/repos/${encodeURIComponent(page.record.owner.handle)}/${encodeURIComponent(page.record.name)}/actions`}
        run={run.value}
        jobId={job?.id ?? null}
        lines={lines?.ok === true ? lines.value.lines : null}
        access={page.access}
        nowMs={Date.now()}
      />
    </ActionsShell>
  );
}
