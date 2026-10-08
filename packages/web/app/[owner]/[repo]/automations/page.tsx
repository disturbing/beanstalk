import { ActionsShell } from '../../../../components/actions/actions-shell';
import styles from '../../../../components/actions/actions.module.css';
import { actionsPage } from '../../../../src/server/actions-page';
import type { RepositoryParams } from '../../../../src/server/repository-page';

type PageProps = { readonly params: RepositoryParams };

export async function generateMetadata({ params }: PageProps) {
  const { owner, repo } = await params;
  return { title: `Automations, ${decodeURIComponent(owner)}/${decodeURIComponent(repo)}` };
}

const EXAMPLE = `# .beanstalk/automations/posthog-errors.yml
name: PostHog errors → beans
on:
  schedule: [{ cron: "0 * * * *" }]
  validation_red:
permissions:
  beans: write
jobs:
  triage:
    steps:
      - uses: beanstalk/agent@v1
        with:
          budget-usd: 0.50
          mcp: [posthog]
          outputs: open-bean, comment`;

/**
 * Automations → Automations (`docs/claude-opus/25` §1.3, §5.4): coming. Says what they will be
 * and where the file goes, with no list to fill yet.
 */
export default async function AutomationsPage({ params }: PageProps) {
  const page = await actionsPage(params);
  return (
    <ActionsShell page={page} view="automations" mode={page.actions?.mode ?? null}>
      <section className={styles.box} aria-labelledby="automations-title">
        <div className={styles.coming}>
          <div>
            <h2 id="automations-title">
              Automations <span className={styles.soon}>coming</span>
            </h2>
            <p>
              An automation is a workflow file in <code>.beanstalk/automations/</code>: the same{' '}
              <code>on:</code> triggers as Actions, plus Beanstalk events such as a red validation
              or a landed bean. Its steps open beans, comment and raise decision cards, or hand a
              task to an agent session with a budget.
            </p>
            <p>
              They run in isolates that start in milliseconds, act as the repository&rsquo;s own
              bot, and never see your secrets. Like workflows, they change by a bean that lands on
              the stalk.
            </p>
            <p>
              Until then, <a href={`${page.base}/actions`}>Actions</a> runs the workflows in{' '}
              <code>.github/workflows/</code>.
            </p>
          </div>
          <pre className={styles.yaml} aria-label="An example automation">
            {EXAMPLE}
          </pre>
        </div>
      </section>
    </ActionsShell>
  );
}
