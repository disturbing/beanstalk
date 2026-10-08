/**
 * One log line: ANSI colours as styled spans (theme colours for the 16 named ones), and a
 * workflow command (`::error file=…::`) shown as the annotation it makes. Text only, never
 * HTML.
 */
import type { CSSProperties } from 'react';

import type { AnsiColour, AnsiStyle } from '../../src/actions/ansi';
import { parseAnsi } from '../../src/actions/ansi';
import { workflowCommand } from '../../src/actions/log-view';
import styles from './actions.module.css';

export function AnsiText({ text }: { readonly text: string }) {
  const command = workflowCommand(text);
  if (command !== null)
    return (
      <span className={styles.text}>
        <span className={command.level === 'error' ? styles.lineError : styles.lineWarning}>
          {command.level === 'error' ? 'Error' : 'Warning'}:
        </span>{' '}
        {command.message}
        {command.path === null ? null : (
          <span className={styles.muted}>
            {' '}
            ({command.path}
            {command.line === null ? '' : `:${command.line}`})
          </span>
        )}
      </span>
    );
  return (
    <span className={styles.text}>
      {parseAnsi(text).map((run, index) => (
        <span key={index} className={classesOf(run.style)} style={inlineOf(run.style)}>
          {run.text}
        </span>
      ))}
    </span>
  );
}

function classesOf(style: AnsiStyle): string | undefined {
  const names = [
    named(style.fg, 'fg'),
    named(style.bg, 'bg'),
    style.bold ? styles.bold : undefined,
    style.dim ? styles.dim : undefined,
    style.italic ? styles.italic : undefined,
    style.underline ? styles.underline : undefined,
  ].filter((name) => name !== undefined);
  return names.length === 0 ? undefined : names.join(' ');
}

function named(colour: AnsiColour | null, layer: 'fg' | 'bg'): string | undefined {
  if (colour?.kind !== 'named') return undefined;
  return styles[`${layer}-${colour.name}`];
}

function inlineOf(style: AnsiStyle): CSSProperties | undefined {
  const fg = style.fg?.kind === 'rgb' ? style.fg.css : undefined;
  const bg = style.bg?.kind === 'rgb' ? style.bg.css : undefined;
  if (fg === undefined && bg === undefined) return undefined;
  return { color: fg, background: bg };
}
