/**
 * Home's first-visit checklist (`docs/claude-opus/16` item 1.6): connect an agent session,
 * create or import a repository, push a first bean. Each step is done from facts Home already
 * has; the list goes away once all three are.
 */
export type FirstStepId = 'connect' | 'repository' | 'bean';

export type FirstStep = { readonly id: FirstStepId; readonly done: boolean };

export type FirstStepFacts = {
  /** Agent sessions connected to this account (listed or settling). */
  readonly sessions: number;
  readonly repositories: number;
  /** Repositories whose engine has grown at least one bean. */
  readonly repositoriesWithBeans: number;
};

export function firstSteps(facts: FirstStepFacts): readonly FirstStep[] {
  return [
    { id: 'connect', done: facts.sessions > 0 },
    { id: 'repository', done: facts.repositories > 0 },
    { id: 'bean', done: facts.repositoriesWithBeans > 0 },
  ];
}

export function isStarted(steps: readonly FirstStep[]): boolean {
  return steps.every((step) => step.done);
}

/** How often Home asks for sessions: fast until one connects, then slowly. */
export function sessionsPollMs(
  sessions: readonly { readonly settling?: boolean | undefined }[],
): number {
  if (sessions.length === 0 || sessions.some((session) => session.settling === true)) return 3000;
  return 30_000;
}
