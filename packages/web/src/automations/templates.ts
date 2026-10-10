/**
 * What "New automation" starts from (doc 25 §7.13): a few files people ask for first, each a
 * valid automation as written, with comments that stay in the file when the form edits it.
 */

export type AutomationTemplate = {
  readonly id: string;
  readonly title: string;
  readonly summary: string;
  /** The file name it suggests (`<id>.yml`). */
  readonly file: string;
  readonly source: string;
};

export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  {
    id: 'fix-red',
    title: 'Fix red beans',
    summary:
      'When a bean goes red, an agent reads why, fixes it in a new bean and notes what it learned.',
    file: 'fix-red.yml',
    source: `# Fixes beans whose pre-land check went red.
name: Fix red beans
on:
  bean_red:
    beans: ['*', '!fix-*']   # not its own fixes
permissions:
  beans: write               # may push fix beans; they pass pre-land like any other
max-cost-usd: 0.5
prompt: |
  Read why the bean went red (git fetch its branch and run the tests).
  Check your memory for this kind of failure first.
  Fix it in a new bean named fix-<bean>, then note what you tried and learned.
`,
  },
  {
    id: 'dependency-bump',
    title: 'Weekly dependency bump',
    summary: 'Every Monday, update dependencies one at a time and push a bean for those that pass.',
    file: 'dependency-bump.yml',
    source: `# Keeps dependencies fresh, one small bean at a time.
name: Weekly dependency bump
on:
  schedule: [{ cron: "0 6 * * 1" }]   # Mondays 06:00 UTC
permissions:
  beans: write
timeout-minutes: 45
max-cost-usd: 1
prompt: |
  List outdated dependencies. Update them one at a time (patch and minor only),
  run the tests after each, and push one bean per update that passes.
  Note in memory any update that failed and why, and skip it next week.
`,
  },
  {
    id: 'landed-summary',
    title: 'Summarise landed work',
    summary: 'Every Friday, write a short summary of what landed this week to the repository.',
    file: 'landed-summary.yml',
    source: `# A weekly note of what landed, kept in the repository.
name: Summarise landed work
on:
  schedule: [{ cron: "0 16 * * 5" }]  # Fridays 16:00 UTC
permissions:
  beans: write
max-cost-usd: 0.3
prompt: |
  Read the stalk's history for the last seven days (git log origin/stalk).
  Write a short summary, grouped by area, to docs/weekly/<date>.md and push it as a bean.
  Keep a one-line pointer in memory so next week starts where this one ended.
`,
  },
  {
    id: 'triage-decisions',
    title: 'Triage decision cards',
    summary: 'When a decision card opens, compare the beans and leave a recommendation in memory.',
    file: 'triage-decisions.yml',
    source: `# Reads both sides of a decision and recommends one.
name: Triage decision cards
on:
  decision_opened:
max-cost-usd: 0.3
prompt: |
  A decision card opened between beans. Fetch each bean's branch, read its diff
  and its intent, and run the tests on each.
  Write a short recommendation (which one, and why) to decisions.md in your memory.
`,
  },
  {
    id: 'heartbeat',
    title: 'Shell heartbeat',
    summary: 'A tiny shell hook every hour: no model, just a script with the workspace and memory.',
    file: 'heartbeat.yml',
    source: `# A shell automation: no model, just a script.
name: Heartbeat
on:
  schedule: [{ cron: "0 * * * *" }]
harness: shell
run: |
  echo "beat $(date -u +%FT%TZ)" >> "$GITSTALK_MEMORY/beats.log"
  wc -l < "$GITSTALK_MEMORY/beats.log"
`,
  },
  {
    id: 'blank',
    title: 'Blank',
    summary: 'An agent you run by hand, with a prompt to fill in.',
    file: 'automation.yml',
    source: `name: New automation
on:
  workflow_dispatch:
prompt: |
  Describe the goal here.
`,
  },
];

/** The template named `id`, or the blank one. */
export function templateOf(id: string | undefined): AutomationTemplate {
  const blank = AUTOMATION_TEMPLATES.at(-1);
  if (blank === undefined) throw new Error('the blank template is always defined');
  return AUTOMATION_TEMPLATES.find((template) => template.id === id) ?? blank;
}
