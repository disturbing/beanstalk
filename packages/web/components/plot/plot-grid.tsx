'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';
import { useEffect } from 'react';

import type { PlotColumn, PlotModel, PlotRow } from '@beanstalk/shared-ask/plot/plot-model';
import { isTestFile } from '@beanstalk/shared-ask/repo/imports';
import { formatClock } from '../../src/race/race-format';
import styles from './plot.module.css';
import type { PlotState } from './plot-url';
import { askPlotHref, plotHref } from './plot-url';

/** Column widths as CSS variables, so narrow screens can shrink them (plot.module.css). */
const COLUMN_WIDTH: Readonly<Record<PlotColumn['kind'], string>> = {
  bed: 'var(--w-bed)',
  file: 'var(--w-file)',
  folded: 'var(--w-folded)',
};
const PHASE_WORDS: Readonly<Record<string, string>> = {
  working: 'writing',
  checking: 'checking',
  rework: 'reworking',
  deciding: 'waiting on a decision',
  queued: 'queued',
  testing: 'in a batch',
};

export type PlotGridProps = {
  readonly run: string;
  readonly model: PlotModel;
  readonly url: PlotState;
  readonly now: number;
  readonly finished: boolean;
  readonly base: string | null;
  readonly focused: 'files' | 'beds' | null;
};

/** The Plot itself: column heads, the growing tip, the landings down to the base. */
export function PlotGrid(props: PlotGridProps) {
  const { model } = props;
  const template = `var(--w-time) var(--w-stalk) minmax(var(--w-title), 1fr) ${model.columns.map((column) => COLUMN_WIDTH[column.kind]).join(' ')}`;
  const style: CSSProperties & Readonly<Record<'--cols', string>> = { '--cols': template };
  useRevealSelected(props.url.bean);
  return (
    <div className={styles.plot} style={style}>
      <ColumnHeads {...props} />
      <Tip {...props} />
      {model.rows.map((row, index) => (
        <Row
          key={row.kind === 'landing' ? `l${row.idx}` : `f${index}`}
          row={row}
          index={index}
          grid={props}
        />
      ))}
      <div className={styles.seed}>
        <div className={styles.time}>base</div>
        <div className={styles.stalk} />
        <span>
          The base commit
          {props.base === null ? (
            ''
          ) : (
            <span className={styles.mono}> {props.base.slice(0, 7)}</span>
          )}
          , where the run began
        </span>
      </div>
    </div>
  );
}

function ColumnHeads(props: PlotGridProps) {
  const { model } = props;
  const note = headNote(props.focused);
  return (
    <div
      className={styles.head}
      data-tall={model.columns.some((column) => column.kind === 'file') ? '' : undefined}
    >
      <div className={styles.headNote}>{note}</div>
      {model.columns.map((column, index) => {
        const crowd = model.crowd[index] ?? 0;
        const key = column.kind === 'file' ? column.path : `${column.kind}-${column.bed}`;
        return (
          <div
            key={key}
            className={styles.colHead}
            data-kind={column.kind}
            data-test={column.kind === 'file' && isTestFile(column.path) ? '' : undefined}
            title={column.kind === 'file' ? column.path : column.bed}
          >
            {column.kind === 'folded' ? null : (
              <Link href={columnHref(props, column)}>
                {column.kind === 'file' ? shortName(column.path) : column.bed}
              </Link>
            )}
            {crowd > 0 && column.kind !== 'folded' ? (
              <b
                className={styles.crowd}
                data-hot={model.hot[index] ? '' : undefined}
                title={`${crowd} in flight here`}
              >
                {crowd}
              </b>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Tip(props: PlotGridProps) {
  const { model } = props;
  if (model.buds.length === 0) {
    return (
      <div className={styles.tip}>
        <div className={styles.note}>
          <span>
            {props.finished
              ? `Nothing is growing: the run ended at ${formatClock(props.now)}. Press play to watch the swarm again.`
              : 'No bean is in flight at this moment.'}
          </span>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.tip}>
      {model.buds.map((bud) => (
        <Link
          key={bud.task}
          href={plotHref(props.run, props.url, {
            bean: bud.task,
            file: null,
            t: Math.round(props.now),
          })}
          className={styles.row}
          data-bud=""
          data-phase={bud.phase}
          aria-current={props.url.bean === bud.task ? 'true' : undefined}
          title={bud.title}
        >
          <div className={styles.time}>
            <span className={styles.agent}>{bud.agent ?? ''}</span>
          </div>
          <div className={styles.stalk}>
            <i className={styles.bud} />
          </div>
          <div className={styles.title}>
            <span>{bud.title}</span>
            <span className={styles.phase}>{PHASE_WORDS[bud.phase] ?? bud.phase}</span>
          </div>
          {bud.cells.map((cell) => (
            <div
              key={cell.column}
              className={styles.cell}
              style={{ gridColumn: cell.column + 4 }}
              data-overlap={cell.overlap ? '' : undefined}
              data-conflict={cell.conflict ? '' : undefined}
            >
              <i className={cell.mark === 'wrote' ? styles.wrote : styles.planned} />
            </div>
          ))}
        </Link>
      ))}
    </div>
  );
}

function Row({
  row,
  index,
  grid,
}: {
  readonly row: PlotRow;
  readonly index: number;
  readonly grid: PlotGridProps;
}) {
  if (row.kind === 'fold') {
    return (
      <div className={styles.fold} data-leaf={row.status}>
        <div className={styles.time} />
        <div className={styles.stalk} />
        <div className={styles.title}>
          {row.count} other bean{row.count === 1 ? '' : 's'}, folded
        </div>
      </div>
    );
  }
  const last = row.cells.at(-1);
  const lastWidth =
    last === undefined ? '0px' : COLUMN_WIDTH[grid.model.columns[last.column]?.kind ?? 'bed'];
  const href =
    row.task === null
      ? plotHref(grid.run, grid.url)
      : plotHref(grid.run, grid.url, { bean: row.task, file: null });
  return (
    <Link
      href={href}
      className={styles.row}
      data-leaf={row.status}
      data-emphasis={row.emphasis}
      aria-current={row.task !== null && grid.url.bean === row.task ? 'true' : undefined}
      title={row.title}
    >
      <div className={styles.time}>{formatClock(row.t)}</div>
      <div className={styles.stalk}>
        <i className={styles.leaf} data-side={index % 2 === 0 ? 'right' : 'left'} />
      </div>
      <div className={styles.title}>
        <span>{row.title}</span>
        <span className={styles.idx}>#{row.idx}</span>
      </div>
      {last === undefined ? null : (
        <div
          className={styles.vein}
          style={{ gridColumn: `4 / ${last.column + 5}`, marginRight: `calc(${lastWidth} / 2)` }}
        />
      )}
      {row.cells.map((cell) => {
        const size = Math.max(6, Math.min(22, 4 + 2.1 * Math.sqrt(cell.lines)));
        return (
          <div key={cell.column} className={styles.cell} style={{ gridColumn: cell.column + 4 }}>
            <i
              className={styles.dot}
              data-tests={cell.testsOnly ? '' : undefined}
              style={{ width: size, height: size }}
            />
          </div>
        );
      })}
    </Link>
  );
}

/** Brings the selected bean's row into view when a bean is opened. */
function useRevealSelected(bean: string | null): void {
  useEffect(() => {
    if (bean === null) return;
    document
      .querySelector(`.${styles.plot} [aria-current='true']`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [bean]);
}

function headNote(focused: PlotGridProps['focused']): string {
  if (focused === 'files') return 'Only the files this answer is about; the other areas fold away.';
  if (focused === 'beds')
    return 'Every area. Marked rows are the beans this answer is about; a ring means two beans in flight change the same file.';
  return 'Newest at the top. Each row is a bean that landed, each column an area of the code.';
}

function columnHref(props: PlotGridProps, column: PlotColumn): string {
  if (column.kind === 'file')
    return plotHref(props.run, props.url, { file: column.path, bean: null });
  return askPlotHref(props.run, props.url, `what changed recently in ${column.bed}?`);
}

function shortName(path: string): string {
  return (path.split('/').at(-1) ?? path).replace(/\.ts$/, '');
}
