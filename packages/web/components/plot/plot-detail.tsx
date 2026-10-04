import Link from 'next/link';
import type { ReactNode } from 'react';

import type { Answer, MainPane, RailBlock } from '@beanstalk/shared-ask/ask/answer';
import type { SectionId } from '@beanstalk/shared-ask/ask/answer-picks';
import { CATALOG } from '@beanstalk/shared-ask/ask/view-spec';
import type {
  BeanDetail,
  BeanRecord,
  DecisionRecord,
} from '@beanstalk/shared-ask/forge/forge-source';
import { journeyOf } from '@beanstalk/shared-ask/plot/journey';
import type { PickReceipt } from '@beanstalk/shared-ask/pick/picker';
import { formatClock, formatUsd } from '../../src/race/race-format';
import { DiffView } from '../explorer/diff-view';
import { FileView } from '../explorer/file-view';
import { PickTag } from './pick-receipts';
import { DecisionStory } from './plot-overview';
import styles from './plot.module.css';
import type { PlotState } from './plot-url';
import { plotHref } from './plot-url';

type Context = { readonly run: string; readonly url: PlotState };

const SECTION_TITLES: Readonly<Record<SectionId, string>> = {
  main: '',
  beans: 'The beans involved',
  decisions: 'Decisions',
  tests: 'Tests that cover it',
  agents: 'The agents',
  red: 'Red validations',
  promotion: 'Waiting for the stalk',
  checks: 'Its checks',
};

/**
 * The reading pane for a question, a bean or a file, rendered on the server from one Ask
 * answer. Sections come in the order the picker chose.
 */
export function PlotDetail(props: Context & { readonly answer: Answer }) {
  const { answer } = props;
  const context = { run: props.run, url: props.url };
  if (answer.main.kind === 'bean' && props.url.bean !== null)
    return <BeanStory {...context} main={answer.main} answer={answer} />;
  if (answer.main.kind === 'file' && props.url.file !== null)
    return <FileStory {...context} main={answer.main} />;
  const sectionsReceipt = answer.picks.find((receipt) => receipt.decision === 'sections') ?? null;
  return (
    <>
      <Link
        className={styles.back}
        href={plotHref(props.run, props.url, { q: '', removed: [], bean: null, file: null })}
      >
        Back to the whole repository
      </Link>
      <p className={styles.kicker}>
        {CATALOG[answer.spec.class].label}: “{answer.question}”
      </p>
      {answer.sections.map((id, index) => (
        <Section
          key={id}
          title={id === 'main' ? mainTitle(answer.main) : SECTION_TITLES[id]}
          receipt={index === 0 ? sectionsReceipt : null}
        >
          {id === 'main' ? (
            <MainSection {...context} main={answer.main} />
          ) : (
            <RailSection {...context} block={railBlock(answer, id)} />
          )}
        </Section>
      ))}
    </>
  );
}

function Section(props: {
  readonly title: string;
  readonly receipt: PickReceipt | null;
  readonly children: ReactNode;
}) {
  return (
    <section>
      <h2 className={styles.paneHeading}>
        {props.title}
        {props.receipt === null ? null : <PickTag receipt={props.receipt} label="arranged" />}
      </h2>
      {props.children}
    </section>
  );
}

function MainSection(props: Context & { readonly main: MainPane }) {
  const { main } = props;
  switch (main.kind) {
    case 'diff':
      return <DiffView files={main.diff.files} />;
    case 'file':
      return (
        <FileView
          beanHref={(bean) => plotHref(props.run, props.url, { bean, file: null })}
          text={main.file.text}
          highlights={main.highlights}
          blame={main.blame}
        />
      );
    case 'bean':
      return <BeanList {...props} beans={[main.bean]} />;
    case 'beans':
      return <BeanList {...props} beans={main.beans} />;
    case 'empty':
      return <p className={styles.proseSmall}>{main.message}</p>;
    default:
      return assertNever(main);
  }
}

function RailSection(props: Context & { readonly block: RailBlock | undefined }) {
  const { block } = props;
  if (block === undefined) return null;
  switch (block.kind) {
    case 'beans':
    case 'promotion':
      return <BeanList {...props} beans={block.beans} />;
    case 'decisions':
      return <Decisions {...props} cards={block.cards} />;
    case 'tests':
      return (
        <ul className={styles.beans}>
          {block.tests.map((test) => (
            <li key={test.path}>
              <Link href={plotHref(props.run, props.url, { file: test.path, bean: null })}>
                <i className={styles.mark} data-kind={test.state === 'fail' ? 'fell' : undefined} />
                <span className={`${styles.beanTitle} ${styles.mono}`}>
                  {test.path.split('/').at(-1)}
                </span>
                <span className={styles.beanMeta}>{test.state}</span>
                <span className={styles.beanSub}>
                  {test.owner === null
                    ? 'in the base repository'
                    : `the acceptance test of ${test.owner}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      );
    case 'agents':
      return (
        <ul className={styles.beans}>
          {block.lanes.map((lane) => (
            <li key={lane.slot}>
              <Link
                href={
                  lane.bean === null
                    ? plotHref(props.run, props.url)
                    : plotHref(props.run, props.url, { bean: lane.bean, file: null })
                }
              >
                <i className={styles.mark} data-kind="flying" />
                <span className={styles.beanTitle}>{lane.slot}</span>
                <span className={styles.beanMeta}>{lane.activity}</span>
                <span className={styles.beanSub}>
                  {lane.bean === null ? 'holding nothing' : `holding ${lane.bean}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      );
    case 'red':
      return (
        <>
          {block.tickets.map((ticket) => (
            <div key={ticket.ticket} className={styles.story} data-tone="bad">
              <div className={styles.storyTitle}>
                {ticket.ticket}: red at #{ticket.redIdx}
              </div>
              <p>
                Failing:{' '}
                <span className={styles.mono}>
                  {ticket.failing.map((path) => path.split('/').at(-1)).join(', ')}
                </span>
                .{' '}
                {ticket.culprit === null
                  ? 'No culprit named yet.'
                  : `Bisecting named ${ticket.culprit}.`}
              </p>
              {ticket.culprit === null ? null : (
                <div className={styles.acts}>
                  <Link href={plotHref(props.run, props.url, { bean: ticket.culprit, file: null })}>
                    Follow {ticket.culprit}
                  </Link>
                </div>
              )}
            </div>
          ))}
          {block.runs.map((run) => (
            <p key={run.ci} className={styles.proseSmall}>
              {formatClock(run.t)}: a {run.purpose} of {run.subject} went red on{' '}
              <span className={styles.mono}>
                {run.failingFiles.map((path) => path.split('/').at(-1)).join(', ')}
              </span>
              .
            </p>
          ))}
        </>
      );
    case 'checks':
      return <Journey steps={journeyOf(block.steps)} />;
    default:
      return assertNever(block);
  }
}

function BeanStory(
  props: Context & { readonly main: Extract<MainPane, { kind: 'bean' }>; readonly answer: Answer },
) {
  const { bean, diff } = props.main;
  const decision = props.answer.rail
    .flatMap((block) => (block.kind === 'decisions' ? block.cards : []))
    .find((card) => card.card === bean.card);
  return (
    <>
      <Link className={styles.back} href={plotHref(props.run, props.url, { bean: null })}>
        {props.url.q === '' ? 'Back to the whole repository' : 'Back to the answer'}
      </Link>
      <p className={styles.kicker}>
        Bean {bean.id}
        {bean.agent === null ? '' : `, by agent ${bean.agent}`}
      </p>
      <h3 className={styles.paneTitle}>{bean.title}</h3>
      <BeanTags bean={bean} />
      {bean.intent.split('\n\n').map((paragraph, index) => (
        <p key={index} className={styles.prose}>
          {withCode(paragraph)}
        </p>
      ))}
      {bean.lastMessage === '' ? null : (
        <p className={styles.proseSmall}>
          Its agent’s last word: “{firstSentence(bean.lastMessage)}”
        </p>
      )}
      <h2 className={styles.paneHeading}>Its journey</h2>
      <Journey steps={journeyOf(bean.steps)} />
      {decision === undefined ? null : (
        <>
          <h2 className={styles.paneHeading}>The decision</h2>
          <DecisionStory run={props.run} url={props.url} card={decision} />
        </>
      )}
      {diff === null || diff.files.length === 0 ? null : (
        <>
          <h2 className={styles.paneHeading}>
            {bean.landedIdx === null ? 'Its last attempt' : 'What it landed'}
          </h2>
          <DiffView files={diff.files} />
        </>
      )}
    </>
  );
}

function BeanTags({ bean }: { readonly bean: BeanDetail }) {
  return (
    <div className={styles.tags}>
      <span className={styles.tag} data-tone={statusTone(bean.status)}>
        {statusWord(bean.status)}
      </span>
      {bean.landedIdx === null ? null : (
        <span className={styles.tag}>#{bean.landedIdx} on the line</span>
      )}
      {bean.reworks > 0 ? (
        <span className={styles.tag} data-tone="bad">
          {bean.reworks} rework{bean.reworks === 1 ? '' : 's'}
        </span>
      ) : null}
      <span className={styles.tag}>{formatUsd(bean.costUsd)}</span>
      {bean.card === null ? null : (
        <span className={styles.tag} data-tone="decide">
          {bean.card}
        </span>
      )}
    </div>
  );
}

function FileStory(props: Context & { readonly main: Extract<MainPane, { kind: 'file' }> }) {
  const owners = [
    ...new Set((props.main.blame ?? []).flatMap((line) => (line.task === null ? [] : [line.task]))),
  ];
  return (
    <>
      <Link className={styles.back} href={plotHref(props.run, props.url, { file: null })}>
        {props.url.q === '' ? 'Back to the whole repository' : 'Back to the answer'}
      </Link>
      <p className={styles.kicker}>Who wrote each line</p>
      <h3 className={`${styles.paneTitle} ${styles.mono}`}>{props.main.file.path}</h3>
      <p className={styles.proseSmall}>
        {owners.length === 0
          ? 'Every line predates the run.'
          : `${owners.length} bean${owners.length === 1 ? '' : 's'} rewrote parts of this file during the run; each run of lines names the bean that last wrote it.`}
      </p>
      <FileView
        beanHref={(bean) => plotHref(props.run, props.url, { bean, file: null })}
        text={props.main.file.text}
        highlights={props.main.highlights}
        blame={props.main.blame}
      />
    </>
  );
}

function Decisions(props: Context & { readonly cards: readonly DecisionRecord[] }) {
  if (props.cards.length === 0)
    return <p className={styles.proseSmall}>No decision cards touch these files.</p>;
  return (
    <>
      {props.cards.map((card) => (
        <DecisionStory key={card.card} run={props.run} url={props.url} card={card} />
      ))}
    </>
  );
}

function BeanList(props: Context & { readonly beans: readonly BeanRecord[] }) {
  if (props.beans.length === 0) return <p className={styles.proseSmall}>No beans.</p>;
  return (
    <ul className={styles.beans}>
      {props.beans.map((bean) => (
        <li key={bean.id}>
          <Link href={plotHref(props.run, props.url, { bean: bean.id, file: null })}>
            <i className={styles.mark} data-kind={markKind(bean.status)} />
            <span className={styles.beanTitle}>{bean.title}</span>
            <span className={styles.beanMeta}>
              {bean.landedIdx === null ? '' : `#${bean.landedIdx}, `}
              {bean.landedAt === null ? '' : formatClock(bean.landedAt)}
            </span>
            <span className={styles.beanSub}>
              {bean.id}
              {bean.agent === null ? '' : `, ${bean.agent}`}, {statusWord(bean.status)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Journey({ steps }: { readonly steps: ReturnType<typeof journeyOf> }) {
  return (
    <ol className={styles.journey}>
      {steps.map((step, index) => (
        <li key={index} data-tone={step.tone}>
          <div className={styles.journeyTime}>{formatClock(step.t)}</div>
          <div>{step.text}</div>
        </li>
      ))}
    </ol>
  );
}

function railBlock(answer: Answer, id: SectionId): RailBlock | undefined {
  return answer.rail.find((block) => block.kind === id);
}

function mainTitle(main: MainPane): string {
  switch (main.kind) {
    case 'diff':
      return main.title;
    case 'file':
      return main.blame === null
        ? main.title
        : `Who wrote each line of ${main.title.split('/').at(-1) ?? main.title}`;
    case 'bean':
      return 'The bean to read first';
    case 'beans':
    case 'empty':
      return main.title;
    default:
      return assertNever(main);
  }
}

function statusWord(status: BeanRecord['status']): string {
  switch (status) {
    case 'green':
      return 'on the stalk';
    case 'landed':
      return 'on the sprout';
    case 'in-flight':
      return 'in flight';
    case 'dropped':
      return 'fell off';
    case 'reverted':
      return 'reverted';
    case 'pending':
      return 'not started';
    default:
      return assertNever(status);
  }
}

function statusTone(status: BeanRecord['status']): string | undefined {
  if (status === 'green' || status === 'landed') return 'good';
  if (status === 'dropped' || status === 'reverted') return 'bad';
  if (status === 'in-flight') return 'bean';
  return undefined;
}

function markKind(status: BeanRecord['status']): string | undefined {
  if (status === 'landed') return 'sprout';
  if (status === 'dropped' || status === 'reverted') return 'fell';
  if (status === 'in-flight' || status === 'pending') return 'flying';
  return undefined;
}

/** Inline `code` in a task's prose, set in the code face. */
function withCode(text: string): ReactNode {
  return text.split(/(`[^`]+`)/).map((part, index) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <span key={index} className={styles.mono}>
        {part.slice(1, -1)}
      </span>
    ) : (
      part
    ),
  );
}

function firstSentence(text: string): string {
  const line = text.split('\n')[0] ?? text;
  return line.length > 240 ? `${line.slice(0, 240)}…` : line;
}

function assertNever(value: never): never {
  throw new Error(`unexpected value ${String(value)}`);
}
