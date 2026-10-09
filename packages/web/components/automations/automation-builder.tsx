'use client';

/**
 * The automation builder (doc 25 §7.13): a form and the file's YAML side by side (tabs on a
 * phone), kept in sync both ways, validated live by the gateway's own parser. Save pushes a
 * bean built from the draft on top of the version the editor opened, and follows it until it
 * lands or comes back red. If the file changed meanwhile, the save merges field by field (or
 * asks), and the draft is kept in this browser until it is saved.
 */
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import type { BeanstalkEvent } from '@beanstalk/shared-race/actions';
import type { AutomationBase } from '@beanstalk/shared-race/automation-editor';
import { slugOf } from '@beanstalk/shared-race/automation-editor';
import { readAutomationFile } from '@beanstalk/shared-race/automation-file';

import type { EventFilter, FieldPath } from '../../src/automations/automation-draft';
import {
  formOf,
  readDraft,
  setCrons,
  setEvent,
  setEventFilter,
  setField,
} from '../../src/automations/automation-draft';
import type { Pick } from '../../src/automations/automation-merge';
import { mergeAutomation, resolveMerge } from '../../src/automations/automation-merge';
import type { BeanStatus, Theirs } from '../../src/automations/editor-client';
import {
  automationBeanAction,
  saveAutomationAction,
  testAutomationAction,
} from '../../src/server/automation-editor-actions';
import type { FieldProblems } from './builder-form';
import { BuilderForm } from './builder-form';
import styles from './builder.module.css';
import type { MergeView } from './merge-panel';
import { MergePanel } from './merge-panel';
import type { LineProblem } from './yaml-pane';
import { YamlPane } from './yaml-pane';

const DIR = '.beanstalk/automations/';
const POLL_MS = 1500;

export type BuilderProps = {
  readonly mode: 'new' | 'edit';
  readonly repo: { readonly owner: string; readonly name: string; readonly base: string };
  readonly csrf: string | null;
  readonly path: string;
  /** The version the editor opened: the latest landed commit and the file's blob and text. */
  readonly opened: { readonly base: AutomationBase; readonly text: string | null };
  readonly initialText: string;
  readonly save:
    | { readonly kind: 'allowed' }
    | { readonly kind: 'refused'; readonly reason: string };
  readonly canTestRun: boolean;
  readonly secretNames: readonly string[];
  readonly models: readonly string[];
  readonly defaultModel: string;
  readonly maxTimeoutMinutes: number;
  readonly nowMs: number;
};

type Phase =
  | { readonly kind: 'editing' }
  | { readonly kind: 'merging'; readonly view: MergeView; readonly theirs: Theirs }
  | {
      readonly kind: 'pushed';
      readonly bean: string;
      readonly commit: string;
      readonly deleted: boolean;
      readonly status: BeanStatus | null;
    };

type Notice = {
  readonly tone: 'bad' | 'good' | 'plain';
  readonly text: string;
  readonly href?: string;
};

export function AutomationBuilder(props: BuilderProps) {
  const [text, setText] = useState(props.initialText);
  const [path, setPath] = useState(props.path);
  const [opened, setOpened] = useState(props.opened);
  const [phase, setPhase] = useState<Phase>({ kind: 'editing' });
  const [notice, setNotice] = useState<Notice | null>(null);
  const [tab, setTab] = useState<'form' | 'yaml'>('form');
  const [message, setMessage] = useState('');
  const [isBusy, startBusy] = useTransition();
  const draftKey = `bs-automation-draft:${props.repo.owner}/${props.repo.name}:${props.mode === 'new' ? 'new' : props.path}`;
  const restore = useStoredDraft(draftKey, text, props.initialText);

  const parsed = useMemo(() => readDraft(text), [text]);
  const file = useMemo(
    () => readAutomationFile(path, text, { maxTimeoutMinutes: props.maxTimeoutMinutes }),
    [path, text, props.maxTimeoutMinutes],
  );
  const lineProblems: LineProblem[] =
    parsed.kind === 'syntax'
      ? [...parsed.errors]
      : file.problems.map((problem) => ({ ...problem }));
  const fieldProblems = useMemo(() => problemsByField(file.problems), [file.problems]);
  const form = parsed.kind === 'ok' ? formOf(parsed.value) : null;
  const isPathValid = /^\.beanstalk\/automations\/[a-z0-9][a-z0-9_-]{0,63}\.(?:ya?ml|md)$/.test(
    path,
  );
  const isUnchanged = props.mode === 'edit' && text === opened.text;
  const canSave =
    props.save.kind === 'allowed' &&
    props.csrf !== null &&
    lineProblems.length === 0 &&
    isPathValid;

  const edit = (next: string) => {
    setText(next);
    if (phase.kind === 'pushed' && phase.status !== null && phase.status.phase !== 'checking')
      setPhase({ kind: 'editing' });
  };
  const actions = {
    set: (fieldPath: FieldPath, value: unknown) => edit(setField(text, fieldPath, value)),
    setEvent: (event: BeanstalkEvent, isOn: boolean) => edit(setEvent(text, event, isOn)),
    setFilter: (event: BeanstalkEvent, filter: EventFilter) =>
      edit(setEventFilter(text, event, filter)),
    setCrons: (crons: readonly string[]) => edit(setCrons(text, crons)),
  };

  const formData = (fields: Record<string, string>): FormData => {
    const data = new FormData();
    data.set('csrf', props.csrf ?? '');
    data.set('owner', props.repo.owner);
    data.set('name', props.repo.name);
    for (const [key, value] of Object.entries(fields)) data.set(key, value);
    return data;
  };

  const push = (content: string | null, base: AutomationBase, baseText: string | null) =>
    startBusy(async () => {
      setNotice(null);
      const answer = await saveAutomationAction(
        formData({
          path,
          base: JSON.stringify(base),
          content: content ?? '',
          mode: content === null ? 'delete' : 'save',
          message,
        }),
      );
      if (answer.kind === 'refused') {
        setNotice({ tone: 'bad', text: answer.message });
        return;
      }
      const result = answer.result;
      if (result.kind === 'stale') {
        const view = mergeAutomation({
          base: baseText,
          theirs: result.theirs.content,
          ours: content ?? '',
        });
        setPhase({ kind: 'merging', view, theirs: result.theirs });
        return;
      }
      forgetDraft(draftKey);
      setPhase({
        kind: 'pushed',
        bean: result.bean,
        commit: result.commit,
        deleted: content === null,
        status: null,
      });
    });

  const saveMerged = (picks: ReadonlyMap<string, Pick>) => {
    if (phase.kind !== 'merging') return;
    const { view, theirs } = phase;
    const merged = mergedText(view, { theirs, ours: text, picks });
    if (!merged.ok) {
      setNotice({ tone: 'bad', text: `The edited value for ${merged.field} is not YAML.` });
      return;
    }
    setText(merged.text);
    setOpened({ base: theirs.base, text: theirs.content });
    setPhase({ kind: 'editing' });
    push(merged.text, theirs.base, theirs.content);
  };

  const takeTheirs = () => {
    if (phase.kind !== 'merging') return;
    const { theirs } = phase;
    setOpened({ base: theirs.base, text: theirs.content });
    if (theirs.content !== null) setText(theirs.content);
    setPhase({ kind: 'editing' });
    if (theirs.content === null)
      setNotice({
        tone: 'plain',
        text: 'It stays deleted.',
        href: `${props.repo.base}/automations`,
      });
  };

  const testRun = () =>
    startBusy(async () => {
      const answer = await testAutomationAction(formData({ path, content: text }));
      setNotice(
        answer.kind === 'started'
          ? { tone: 'good', text: 'Test run started: view it', href: answer.href }
          : { tone: 'bad', text: answer.message },
      );
    });

  useBeanPolling(phase, setPhase, (bean) => automationBeanAction(formData({ bean })));

  const fileField =
    props.mode === 'new' ? (
      <FileName
        path={path}
        onChange={setPath}
        isValid={isPathValid}
        suggestion={form === null ? '' : slugOf(form.name)}
      />
    ) : null;
  const shownText =
    phase.kind === 'merging' && phase.view.kind === 'merged' ? phase.view.text : text;

  return (
    <div className={styles.builder}>
      <header className={styles.head}>
        <div>
          <h2>{props.mode === 'new' ? 'New automation' : `Edit ${form?.name ?? path}`}</h2>
          <p className={styles.path}>
            {path} · saves as a bean: pre-land check, then live when the stalk takes it
          </p>
        </div>
        <div className={styles.tabs} role="tablist" aria-label="View">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'form'}
            onClick={() => setTab('form')}
          >
            Form
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'yaml'}
            onClick={() => setTab('yaml')}
          >
            YAML{lineProblems.length > 0 ? ` (${lineProblems.length})` : ''}
          </button>
        </div>
      </header>
      {restore === null ? null : (
        <p className={styles.banner} role="status">
          An unsaved draft from {restore.when} is kept in this browser.{' '}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              setText(restore.text);
              restore.dismiss();
            }}
          >
            Restore it
          </button>{' '}
          <button
            type="button"
            className={styles.linkButton}
            onClick={() => {
              forgetDraft(draftKey);
              restore.dismiss();
            }}
          >
            Discard
          </button>
        </p>
      )}
      {props.save.kind === 'refused' ? (
        <p className={styles.banner} data-tone="bad" role="note">
          {props.save.reason} You can edit and copy the YAML, but not save it.
        </p>
      ) : null}
      <div className={styles.columns} data-tab={tab}>
        <div className={styles.formCol}>
          {phase.kind === 'merging' ? (
            <MergePanel
              view={phase.view}
              author={phase.theirs.author}
              busy={isBusy}
              onSave={saveMerged}
              onTakeTheirs={takeTheirs}
              onBack={() => setPhase({ kind: 'editing' })}
            />
          ) : null}
          {form === null ? (
            <p className={styles.banner} data-tone="bad">
              The YAML does not parse, so the form is paused. Fix it in the YAML view (line{' '}
              {lineProblems[0]?.line ?? '?'}).
            </p>
          ) : (
            <BuilderForm
              form={form}
              problems={fieldProblems}
              actions={actions}
              secretNames={props.secretNames}
              models={props.models}
              defaultModel={props.defaultModel}
              maxTimeoutMinutes={props.maxTimeoutMinutes}
              nowMs={props.nowMs}
              fileField={fileField}
            />
          )}
        </div>
        <aside className={styles.yamlCol} aria-label="The file">
          <YamlPane path={path} text={shownText} problems={lineProblems} onChange={edit} />
        </aside>
      </div>
      <footer className={styles.saveBar}>
        <BeanLine phase={phase} base={props.repo.base} path={path} />
        {notice === null ? null : (
          <p className={styles.notice} data-tone={notice.tone} role="status">
            {notice.href === undefined ? (
              notice.text
            ) : (
              <Link href={notice.href}>{notice.text}</Link>
            )}
          </p>
        )}
        <div className={styles.saveRow}>
          <input
            className={styles.input}
            aria-label="Commit message"
            placeholder={props.mode === 'new' ? 'Add automation' : 'Edit automation'}
            value={message}
            maxLength={200}
            onChange={(event) => setMessage(event.target.value)}
          />
          <button
            type="button"
            className={styles.primary}
            disabled={!canSave || isUnchanged || isBusy || phase.kind === 'merging'}
            onClick={() => push(text, opened.base, opened.text)}
          >
            {isBusy ? 'Saving…' : 'Save as bean'}
          </button>
          {props.canTestRun ? (
            <button
              type="button"
              className={styles.button}
              disabled={!canSave || isBusy}
              onClick={testRun}
              title="Runs this draft once by hand, without saving it"
            >
              Test run
            </button>
          ) : null}
          {props.mode === 'edit' && props.save.kind === 'allowed' ? (
            <DeleteControl
              file={path.slice(DIR.length)}
              isBusy={isBusy}
              onDelete={() => push(null, opened.base, opened.text)}
            />
          ) : null}
        </div>
      </footer>
    </div>
  );
}

/** Delete asks first: a bean removes the file, as any other change. */
function DeleteControl(props: {
  readonly file: string;
  readonly isBusy: boolean;
  readonly onDelete: () => void;
}) {
  const [isConfirming, setConfirming] = useState(false);
  if (!isConfirming)
    return (
      <button
        type="button"
        className={styles.danger}
        disabled={props.isBusy}
        onClick={() => setConfirming(true)}
      >
        Delete…
      </button>
    );
  return (
    <span className={styles.confirm}>
      Delete {props.file}? A bean removes it.
      <button
        type="button"
        className={styles.danger}
        disabled={props.isBusy}
        onClick={() => {
          setConfirming(false);
          props.onDelete();
        }}
      >
        Delete
      </button>
      <button type="button" className={styles.button} onClick={() => setConfirming(false)}>
        Keep
      </button>
    </span>
  );
}

function FileName(props: {
  readonly path: string;
  readonly onChange: (path: string) => void;
  readonly isValid: boolean;
  readonly suggestion: string;
}) {
  const name = props.path.slice(DIR.length).replace(/\.ya?ml$/, '');
  return (
    <label className={styles.inline}>
      <span>File</span>
      <span className={styles.fileName}>
        <span className={styles.mono}>{DIR}</span>
        <input
          className={`${styles.input} ${styles.mono}`}
          aria-label="File name"
          value={name}
          onChange={(event) =>
            props.onChange(`${DIR}${slugOf(event.target.value) || event.target.value}.yml`)
          }
        />
        <span className={styles.mono}>.yml</span>
      </span>
      {props.isValid ? null : (
        <small className={styles.problem}>Lowercase letters, digits, - and _.</small>
      )}
      {props.suggestion !== '' && props.suggestion !== name ? (
        <button
          type="button"
          className={styles.linkButton}
          onClick={() => props.onChange(`${DIR}${props.suggestion}.yml`)}
        >
          Use {props.suggestion}.yml
        </button>
      ) : null}
    </label>
  );
}

/** The saved bean's journey: checking → landed (Saved), or red with why. */
function BeanLine(props: { readonly phase: Phase; readonly base: string; readonly path: string }) {
  const { phase } = props;
  if (phase.kind !== 'pushed') return null;
  const status = phase.status;
  const beanLink = (
    <Link href={`${props.base}/changes/${encodeURIComponent(phase.bean)}`} className={styles.mono}>
      bean/{phase.bean}
    </Link>
  );
  if (status === null || status.phase === 'checking' || status.phase === 'waiting')
    return (
      <p className={styles.beanLine} data-phase="checking" role="status">
        <span className={styles.dot} aria-hidden="true" /> Saved as {beanLink}: checking…
      </p>
    );
  if (status.phase === 'landed' || status.phase === 'green') {
    const sha = status.landedSha ?? phase.commit;
    return (
      <p className={styles.beanLine} data-phase="landed" role="status">
        ✓ Saved. {beanLink} landed as{' '}
        <Link
          className={styles.mono}
          href={
            phase.deleted
              ? `${props.base}/tree?ref=${encodeURIComponent(sha)}`
              : `${props.base}/blob/${props.path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(sha)}`
          }
        >
          {sha.slice(0, 7)}
        </Link>
        ; live when the stalk takes it.{' '}
        <Link href={`${props.base}/automations`}>Back to automations</Link>
      </p>
    );
  }
  return (
    <div className={styles.beanLine} data-phase="red" role="alert">
      <p>
        ✗ {beanLink} is {status.phase}: {status.reason}
      </p>
      {status.details.length === 0 ? null : (
        <ul>
          {status.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {status.phase === 'conflict' ? (
        <p>Someone landed a change first. Save again: it merges with theirs.</p>
      ) : null}
    </div>
  );
}

/** Polls the pushed bean until it has a verdict. */
function useBeanPolling(
  phase: Phase,
  setPhase: (phase: Phase) => void,
  read: (
    bean: string,
  ) => Promise<{ kind: 'status'; status: BeanStatus } | { kind: 'refused'; message: string }>,
): void {
  const latest = useRef(phase);
  latest.current = phase;
  const bean = phase.kind === 'pushed' ? phase.bean : null;
  const isWaiting =
    phase.kind === 'pushed' &&
    (phase.status === null ||
      phase.status.phase === 'checking' ||
      phase.status.phase === 'waiting');
  useEffect(() => {
    const timer = setTimeout(() => {
      if (bean === null || !isWaiting) return;
      void (async () => {
        const answer = await read(bean);
        const current = latest.current;
        if (answer.kind !== 'status' || current.kind !== 'pushed' || current.bean !== bean) return;
        setPhase({ ...current, status: answer.status });
      })();
    }, POLL_MS);
    return () => clearTimeout(timer);
  });
}

type Restore = { readonly text: string; readonly when: string; readonly dismiss: () => void };

/** Keeps the draft in this browser (per repository and file) and offers it back on return. */
function useStoredDraft(key: string, text: string, initial: string): Restore | null {
  const [stored, setStored] = useState<{ text: string; savedAt: string } | null>(null);
  const [isDismissed, setDismissed] = useState(false);
  useEffect(() => {
    const found = readStored(key);
    if (found !== null && found.text !== initial) setStored(found);
  }, [key, initial]);
  useEffect(() => {
    if (text === initial) return;
    try {
      window.localStorage.setItem(key, JSON.stringify({ text, savedAt: new Date().toISOString() }));
    } catch {
      // Storage can be off (private windows); the draft then lives only in this page.
    }
  }, [key, text, initial]);
  if (stored === null || isDismissed || stored.text === text) return null;
  return {
    text: stored.text,
    when: stored.savedAt.slice(0, 16).replace('T', ' '),
    dismiss: () => setDismissed(true),
  };
}

function readStored(key: string): { text: string; savedAt: string } | null {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(key) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return null;
    const text: unknown = Reflect.get(raw, 'text');
    const savedAt: unknown = Reflect.get(raw, 'savedAt');
    return typeof text === 'string' && typeof savedAt === 'string' ? { text, savedAt } : null;
  } catch {
    return null;
  }
}

function forgetDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing kept, nothing to forget.
  }
}

/** The text a merge resolution saves. */
function mergedText(
  view: MergeView,
  input: {
    readonly theirs: Theirs;
    readonly ours: string;
    readonly picks: ReadonlyMap<string, Pick>;
  },
): { readonly ok: true; readonly text: string } | { readonly ok: false; readonly field: string } {
  switch (view.kind) {
    case 'merged':
      return { ok: true, text: view.text };
    case 'conflict':
      return resolveMerge({
        theirs: input.theirs.content ?? '',
        ours: input.ours,
        ourChanges: view.ourChanges,
        conflicts: view.conflicts,
        picks: input.picks,
      });
    case 'deleted':
    case 'unparsed':
      return { ok: true, text: input.ours };
    default:
      return view satisfies never;
  }
}

/** The validator's problems by the top-level key their message starts with. */
function problemsByField(problems: readonly { readonly message: string }[]): FieldProblems {
  const byField = new Map<string, string[]>();
  for (const problem of problems) {
    const match = /^([a-z-]+)(?:[.:])/.exec(problem.message);
    const key = match?.[1] ?? '';
    byField.set(key, [...(byField.get(key) ?? []), problem.message]);
  }
  return byField;
}
