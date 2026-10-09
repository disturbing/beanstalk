'use client';

/**
 * What the builder shows when the file changed since it was opened (doc 25 §7.13): the merged
 * result to confirm before pushing, or, for fields both sides changed, theirs and yours side by
 * side to pick or edit. The draft is never lost: "Back to editing" keeps it.
 */
import { useState } from 'react';
import { stringify } from 'yaml';

import type { FieldPath } from '../../src/automations/automation-draft';
import type { FieldConflict, Pick } from '../../src/automations/automation-merge';
import { keyOf } from '../../src/automations/automation-merge';
import styles from './builder.module.css';

export type MergeView =
  | {
      readonly kind: 'merged';
      readonly text: string;
      readonly theirChanges: readonly FieldPath[];
      readonly ourChanges: readonly FieldPath[];
    }
  | {
      readonly kind: 'conflict';
      readonly conflicts: readonly FieldConflict[];
      readonly theirChanges: readonly FieldPath[];
      readonly ourChanges: readonly FieldPath[];
    }
  | { readonly kind: 'deleted'; readonly oursChanged: boolean }
  | { readonly kind: 'unparsed' };

export function MergePanel(props: {
  readonly view: MergeView;
  /** Who changed it (the newest commit's author), when known. */
  readonly author: string | null;
  readonly busy: boolean;
  readonly onSave: (picks: ReadonlyMap<string, Pick>) => void;
  readonly onTakeTheirs: () => void;
  readonly onBack: () => void;
}) {
  const who = props.author === null ? 'someone' : `@${props.author}`;
  const { view } = props;
  return (
    <section className={styles.merge} aria-live="polite" aria-labelledby="merge-title">
      {view.kind === 'merged' ? (
        <>
          <h2 id="merge-title">A new version was saved while you edited</h2>
          <p>
            Merged with {who}&rsquo;s change to {fieldList(view.theirChanges)}. Your change to{' '}
            {fieldList(view.ourChanges)} is kept. Check the file beside, then save.
          </p>
          <div className={styles.mergeTools}>
            <button
              type="button"
              className={styles.primary}
              disabled={props.busy}
              onClick={() => props.onSave(new Map())}
            >
              Save merged version
            </button>
            <button type="button" className={styles.button} onClick={props.onBack}>
              Back to editing
            </button>
          </div>
        </>
      ) : null}
      {view.kind === 'conflict' ? <Conflicts {...props} view={view} who={who} /> : null}
      {view.kind === 'deleted' ? (
        <>
          <h2 id="merge-title">{who} deleted this automation</h2>
          <p>
            {view.oursChanged
              ? 'Saving recreates it with your version. Or keep it deleted and drop your draft.'
              : 'You changed nothing since it was deleted.'}
          </p>
          <div className={styles.mergeTools}>
            {view.oursChanged ? (
              <button
                type="button"
                className={styles.primary}
                disabled={props.busy}
                onClick={() => props.onSave(new Map())}
              >
                Recreate with my version
              </button>
            ) : null}
            <button type="button" className={styles.button} onClick={props.onTakeTheirs}>
              Keep it deleted
            </button>
          </div>
        </>
      ) : null}
      {view.kind === 'unparsed' ? (
        <>
          <h2 id="merge-title">A new version was posted</h2>
          <p>
            {who} saved a version that cannot be merged field by field. Copy your changes, load
            their version, and try again; or save yours over it.
          </p>
          <div className={styles.mergeTools}>
            <button type="button" className={styles.button} onClick={props.onTakeTheirs}>
              Load their version
            </button>
            <button
              type="button"
              className={styles.danger}
              disabled={props.busy}
              onClick={() => props.onSave(new Map())}
            >
              Save mine over it
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}

function Conflicts(props: {
  readonly view: Extract<MergeView, { kind: 'conflict' }>;
  readonly who: string;
  readonly busy: boolean;
  readonly onSave: (picks: ReadonlyMap<string, Pick>) => void;
  readonly onBack: () => void;
}) {
  const { view } = props;
  const [picks, setPicks] = useState<ReadonlyMap<string, Pick>>(
    () => new Map(view.conflicts.map((conflict) => [keyOf(conflict.path), { kind: 'ours' }])),
  );
  const pick = (key: string, value: Pick) => setPicks(new Map([...picks, [key, value]]));
  return (
    <>
      <h2 id="merge-title">You and {props.who} changed the same fields</h2>
      <p>
        Pick a side for each, or edit it.{' '}
        {view.theirChanges.length > view.conflicts.length
          ? `Their other changes (${fieldList(view.theirChanges)}) are kept. `
          : ''}
        Your draft is kept until you save.
      </p>
      <ol className={styles.conflicts}>
        {view.conflicts.map((conflict) => {
          const key = keyOf(conflict.path);
          const chosen = picks.get(key) ?? { kind: 'ours' };
          return (
            <li key={key}>
              <h3>{fieldName(conflict.path)}</h3>
              <div className={styles.sides}>
                <Side
                  title={`Theirs (${props.who})`}
                  value={conflict.theirs}
                  isChosen={chosen.kind === 'theirs'}
                  onPick={() => pick(key, { kind: 'theirs' })}
                />
                <Side
                  title="Yours"
                  value={conflict.ours}
                  isChosen={chosen.kind === 'ours'}
                  onPick={() => pick(key, { kind: 'ours' })}
                />
              </div>
              <details
                className={styles.editPick}
                open={chosen.kind === 'edited'}
                onToggle={(event) => {
                  if (event.currentTarget.open && chosen.kind !== 'edited')
                    pick(key, { kind: 'edited', yaml: yamlOf(conflict.ours) });
                }}
              >
                <summary>Edit a value of my own</summary>
                <textarea
                  className={`${styles.input} ${styles.mono}`}
                  aria-label={`Edited value for ${key}`}
                  rows={4}
                  value={chosen.kind === 'edited' ? chosen.yaml : ''}
                  onChange={(event) => pick(key, { kind: 'edited', yaml: event.target.value })}
                />
              </details>
            </li>
          );
        })}
      </ol>
      <div className={styles.mergeTools}>
        <button
          type="button"
          className={styles.primary}
          disabled={props.busy}
          onClick={() => props.onSave(picks)}
        >
          Save with these picks
        </button>
        <button type="button" className={styles.button} onClick={props.onBack}>
          Back to editing
        </button>
      </div>
    </>
  );
}

function Side(props: {
  readonly title: string;
  readonly value: unknown;
  readonly isChosen: boolean;
  readonly onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.side}
      aria-pressed={props.isChosen}
      onClick={props.onPick}
    >
      <span>{props.title}</span>
      <pre>{props.value === undefined ? '(removed)' : yamlOf(props.value)}</pre>
    </button>
  );
}

function yamlOf(value: unknown): string {
  if (value === undefined) return '';
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

const NAMES: Readonly<Record<string, string>> = {
  name: 'the name',
  prompt: 'the prompt',
  run: 'the script',
  harness: 'the harness',
  model: 'the model',
  secrets: 'the secrets',
  memory: 'memory',
  'timeout-minutes': 'the timeout',
  'max-turns': 'max turns',
  'max-cost-usd': 'the cost cap',
  'on.schedule': 'the schedule',
  'permissions.beans': 'bean permission',
};

/** A field as people say it: "the schedule", "the bean_red trigger". */
export function fieldName(path: FieldPath): string {
  const key = keyOf(path);
  const known = NAMES[key];
  if (known !== undefined) return known;
  return path[0] === 'on' ? `the ${path[1] ?? ''} trigger` : key;
}

function fieldList(paths: readonly FieldPath[]): string {
  if (paths.length === 0) return 'nothing';
  const names = paths.map(fieldName);
  return names.length === 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`;
}
