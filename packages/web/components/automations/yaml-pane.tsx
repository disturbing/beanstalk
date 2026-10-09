'use client';

/**
 * The file itself, beside the form: a text editor with line numbers whose edits update the
 * form at once. Syntax errors and the validator's problems are listed with their line, and a
 * click puts the cursor there.
 */
import { useRef } from 'react';

import styles from './builder.module.css';

export type LineProblem = { readonly line: number | null; readonly message: string };

export function YamlPane(props: {
  readonly path: string;
  readonly text: string;
  readonly problems: readonly LineProblem[];
  readonly onChange: (text: string) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lineCount = props.text.split('\n').length;
  const badLines = new Set(
    props.problems.flatMap((problem) => (problem.line === null ? [] : [problem.line])),
  );
  const goTo = (line: number) => {
    const element = area.current;
    if (element === null) return;
    const lines = props.text.split('\n');
    const offset = lines.slice(0, line - 1).reduce((total, text) => total + text.length + 1, 0);
    element.focus();
    element.setSelectionRange(offset, offset + (lines[line - 1]?.length ?? 0));
  };
  return (
    <div className={styles.yamlPane}>
      <p className={styles.yamlPath}>{props.path}</p>
      <div className={styles.editor}>
        <div className={styles.gutter} ref={gutter} aria-hidden="true">
          {Array.from({ length: lineCount }, (_, index) => (
            <span key={index} data-bad={badLines.has(index + 1) ? 'true' : undefined}>
              {index + 1}
            </span>
          ))}
        </div>
        <textarea
          ref={area}
          className={styles.code}
          aria-label="YAML"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          value={props.text}
          onChange={(event) => props.onChange(event.target.value)}
          onScroll={(event) => {
            if (gutter.current !== null) gutter.current.scrollTop = event.currentTarget.scrollTop;
          }}
        />
      </div>
      {props.problems.length === 0 ? (
        <p className={styles.valid}>✓ valid: the gateway&rsquo;s own checks pass</p>
      ) : (
        <ul className={styles.problems} aria-label="Problems">
          {props.problems.map((problem) => (
            <li key={`${problem.line ?? '-'}:${problem.message}`}>
              {problem.line === null ? (
                <span className={styles.lineTag}>file</span>
              ) : (
                <button
                  type="button"
                  className={styles.lineTag}
                  onClick={() => goTo(problem.line ?? 1)}
                >
                  line {problem.line}
                </button>
              )}
              {problem.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
