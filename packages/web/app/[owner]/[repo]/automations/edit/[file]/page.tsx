import { notFound } from 'next/navigation';

import { ActionsShell } from '../../../../../../components/actions/actions-shell';
import { AutomationBuilder } from '../../../../../../components/automations/automation-builder';
import styles from '../../../../../../components/automations/builder.module.css';
import { actionsPage } from '../../../../../../src/server/actions-page';
import { builderStart } from '../../../../../../src/server/automation-builder-page';

type PageProps = {
  readonly params: Promise<{
    readonly owner: string;
    readonly repo: string;
    readonly file: string;
  }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo, file } = await params;
  return {
    title: `Edit ${decodeURIComponent(file)}, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}`,
  };
}

/**
 * Automations → Edit (doc 25 §7.13): the builder on `.beanstalk/automations/<file>` as the
 * latest landed commit has it. Saving pushes a bean; deleting pushes a bean that removes it.
 */
export default async function EditAutomationPage({ params }: PageProps) {
  const page = await actionsPage(params);
  const { file } = await params;
  const start = await builderStart(page, {
    mode: 'edit',
    path: `.beanstalk/automations/${decodeURIComponent(file)}`,
    template: null,
  });
  if (start.kind === 'missing') notFound();
  return (
    <ActionsShell page={page} view="automations" mode={page.actions?.mode ?? null}>
      {start.kind === 'ready' ? (
        <AutomationBuilder {...start.props} />
      ) : (
        <p className={styles.banner} data-tone="bad">
          {start.message}
        </p>
      )}
    </ActionsShell>
  );
}
