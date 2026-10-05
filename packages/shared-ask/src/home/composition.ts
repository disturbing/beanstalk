/**
 * The generated explorer (design v2): an answer becomes a short list of catalog components,
 * in the order the picker chose its sections. Code fills every component; nothing here
 * writes layout.
 */
import type { TaskId } from '@beanstalk/shared-race/ids';

import type { Answer, RailBlock } from '../ask/answer';
import type { SectionId } from '../ask/answer-picks';
import type { PickReceipt } from '../pick/picker';

export type ComponentId = 'files' | 'journey' | 'decision' | 'red' | 'overlaps';

export const COMPONENT_LABELS: Readonly<Record<ComponentId, string>> = {
  files: 'Files',
  journey: 'Bean journey + diff',
  decision: 'Decision card',
  red: 'Red-validation card',
  overlaps: 'Overlaps + agent activity',
};

export type Composition = {
  readonly components: readonly ComponentId[];
  /** Beans the answer is about: their leaves stay bright on the stalk. */
  readonly relevant: readonly TaskId[];
  /** Files the answer is about. */
  readonly files: readonly string[];
  readonly receipt: PickReceipt | null;
};

const SWARM_CLASSES = new Set(['in-flight', 'agent-activity']);

export function composeAnswer(answer: Answer, selectedBean: TaskId | null): Composition {
  const receipt = answer.picks.find((pick) => pick.decision === 'sections') ?? null;
  if (selectedBean !== null && answer.main.kind === 'bean') {
    return {
      components: answer.main.bean.card === null ? ['journey'] : ['journey', 'decision'],
      relevant: [selectedBean],
      files: answer.main.bean.files,
      receipt,
    };
  }
  const swarm = SWARM_CLASSES.has(answer.spec.class);
  const picked = answer.sections.flatMap((section) => componentOf(section, answer, swarm));
  const components = [...new Set(picked)];
  if (!components.includes('files')) components.push('files');
  return { components, relevant: relevantBeans(answer), files: answer.tree.matched, receipt };
}

function componentOf(section: SectionId, answer: Answer, swarm: boolean): readonly ComponentId[] {
  if (section === 'main') return mainComponent(answer, swarm);
  const block = answer.rail.find((item) => item.kind === section);
  if (block === undefined) return [];
  return railComponent(block);
}

function mainComponent(answer: Answer, swarm: boolean): readonly ComponentId[] {
  if (swarm) return ['overlaps'];
  switch (answer.main.kind) {
    case 'bean':
      return ['journey'];
    case 'beans':
      return ['overlaps'];
    case 'diff':
    case 'file':
    case 'empty':
      return ['files'];
    default:
      return assertNever(answer.main);
  }
}

function railComponent(block: RailBlock): readonly ComponentId[] {
  switch (block.kind) {
    case 'decisions':
      return block.cards.length > 0 ? ['decision'] : [];
    case 'red':
      return block.tickets.length > 0 || block.runs.length > 0 ? ['red'] : [];
    case 'agents':
      return ['overlaps'];
    case 'beans':
    case 'promotion':
    case 'tests':
    case 'checks':
      return [];
    default:
      return assertNever(block);
  }
}

function relevantBeans(answer: Answer): readonly TaskId[] {
  const ids = new Set<TaskId>();
  if (answer.main.kind === 'bean') ids.add(answer.main.bean.id);
  if (answer.main.kind === 'beans') for (const bean of answer.main.beans) ids.add(bean.id);
  for (const block of answer.rail) {
    if (block.kind === 'beans' || block.kind === 'promotion')
      for (const bean of block.beans) ids.add(bean.id);
    if (block.kind === 'decisions')
      for (const card of block.cards) [card.task, ...card.against].forEach((id) => ids.add(id));
    if (block.kind === 'red')
      for (const ticket of block.tickets) if (ticket.culprit !== null) ids.add(ticket.culprit);
  }
  return [...ids];
}

function assertNever(value: never): never {
  throw new Error(`unexpected value ${JSON.stringify(value)}`);
}
