'use client';

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

import { formatClock, formatMinutes, ordinal } from '../../src/race/race-format';
import styles from './greens-chart.module.css';
import { useElementWidth } from './use-element-width';

export type GreensSeries = {
  readonly id: string;
  readonly label: string;
  /** CSS colour of the line (a series token). */
  readonly color: string;
  /** Race seconds of each green, ascending. */
  readonly greens: readonly number[];
  /** When the race ended, if it did. */
  readonly endedAt: number | null;
};

type Props = {
  readonly series: readonly GreensSeries[];
  /** The playhead: lines are drawn up to here. */
  readonly now: number;
  /** The x domain's end, race seconds. */
  readonly until: number;
  readonly beans: number;
  /** Reference counts drawn as hairlines (the k-th greens). */
  readonly marks: readonly number[];
  readonly title: string;
};

const MARGIN = { top: 14, right: 112, bottom: 30, left: 34 };
const HEIGHT = 260;

/**
 * Greens over time for one or two runs: step lines on one axis, a playhead, the k-th
 * green reference lines, direct labels at the line ends, a crosshair readout (pointer and
 * arrow keys) and a table twin.
 */
export function GreensChart({ series, now, until, beans, marks, title }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const width = Math.max(300, useElementWidth(box) ?? 720);
  const [cursor, setCursor] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);
  const tableId = useId();
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + (Math.min(t, until) / until) * plotW;
  const y = (count: number) => MARGIN.top + plotH - (count / beans) * plotH;
  const visibleUntil = Math.min(now, until);

  const moveTo = (t: number) => setCursor(Math.max(0, Math.min(visibleUntil, t)));
  const onPointer = (event: PointerEvent<SVGRectElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    moveTo(((event.clientX - bounds.left) / bounds.width) * until);
  };
  const onKey = (event: KeyboardEvent<SVGSVGElement>) => {
    const step = until / 60;
    if (event.key === 'ArrowRight') moveTo((cursor ?? 0) + step);
    else if (event.key === 'ArrowLeft') moveTo((cursor ?? visibleUntil) - step);
    else if (event.key === 'Escape') setCursor(null);
    else return;
    event.preventDefault();
  };

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>
        <span className={styles.title}>{title}</span>
        <span className={styles.legend}>
          {series.map((line) => (
            <span key={line.id} className={styles.key}>
              <svg width="18" height="8" aria-hidden="true">
                <line
                  x1="1"
                  y1="4"
                  x2="17"
                  y2="4"
                  stroke={line.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
              {line.label}
            </span>
          ))}
        </span>
        <button
          type="button"
          className={styles.tableToggle}
          aria-expanded={asTable}
          aria-controls={tableId}
          onClick={() => setAsTable((open) => !open)}
        >
          {asTable ? 'Hide table' : 'Show as table'}
        </button>
      </figcaption>
      <div ref={box} className={styles.plot}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={summary(series, beans)}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setCursor(null)}
          className={styles.svg}
        >
          <Grid x={x} y={y} until={until} beans={beans} plotW={plotW} />
          {marks.map((count) => (
            <g key={count}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotW}
                y1={y(count)}
                y2={y(count)}
                className={styles.mark}
              />
              <text x={MARGIN.left + 6} y={y(count) - 5} className={styles.markLabel}>
                {ordinal(count)} green
              </text>
            </g>
          ))}
          {series.map((line) => (
            <SeriesLine key={line.id} line={line} x={x} y={y} until={visibleUntil} />
          ))}
          <line
            x1={x(visibleUntil)}
            x2={x(visibleUntil)}
            y1={MARGIN.top}
            y2={MARGIN.top + plotH}
            className={styles.playhead}
          />
          {cursor !== null && (
            <Crosshair at={cursor} series={series} x={x} y={y} plotTop={MARGIN.top} plotH={plotH} />
          )}
          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={onPointer}
            onPointerLeave={() => setCursor(null)}
          />
        </svg>
        {cursor !== null && (
          <Readout at={cursor} series={series} left={Math.min(x(cursor) + 12, width - 190)} />
        )}
      </div>
      {asTable && <GreensTable id={tableId} series={series} marks={marks} />}
    </figure>
  );
}

function Grid(props: {
  readonly x: (t: number) => number;
  readonly y: (count: number) => number;
  readonly until: number;
  readonly beans: number;
  readonly plotW: number;
}) {
  const minutes = props.until / 60;
  const stepMinutes = minutes > 30 ? 10 : 5;
  const ticks = Array.from(
    { length: Math.floor(minutes / stepMinutes) + 1 },
    (_, index) => index * stepMinutes,
  );
  const counts = [0, 10, 20, 30, 40].filter((count) => count <= props.beans);
  return (
    <g>
      {counts.map((count) => (
        <g key={count}>
          <line
            x1={MARGIN.left}
            x2={MARGIN.left + props.plotW}
            y1={props.y(count)}
            y2={props.y(count)}
            className={styles.grid}
          />
          <text
            x={MARGIN.left - 8}
            y={props.y(count) + 4}
            className={styles.axisLabel}
            textAnchor="end"
          >
            {count}
          </text>
        </g>
      ))}
      {ticks.map((minute) => (
        <text
          key={minute}
          x={props.x(minute * 60)}
          y={HEIGHT - 8}
          className={styles.axisLabel}
          textAnchor="middle"
        >
          {minute} min
        </text>
      ))}
    </g>
  );
}

function SeriesLine(props: {
  readonly line: GreensSeries;
  readonly x: (t: number) => number;
  readonly y: (count: number) => number;
  readonly until: number;
}) {
  const { line, x, y } = props;
  const ended = line.endedAt !== null && line.endedAt <= props.until;
  const until = line.endedAt !== null && ended ? line.endedAt : props.until;
  const shown = line.greens.filter((t) => t <= until);
  const points = stepPoints(shown, until).map(([t, count]) => `${x(t)},${y(count)}`);
  const count = shown.length;
  const endX = x(until);
  return (
    <g>
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={line.color}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={endX} cy={y(count)} r="4.5" fill={line.color} className={styles.endDot} />
      <text x={endX + 9} y={y(count) + 4} className={styles.endLabel}>
        {count} green{ended ? ', finished' : ''}
      </text>
    </g>
  );
}

/** Points of a step line: flat until each green, then up one. */
function stepPoints(
  greens: readonly number[],
  until: number,
): readonly (readonly [number, number])[] {
  const points: (readonly [number, number])[] = [[0, 0]];
  greens.forEach((t, index) => {
    points.push([t, index], [t, index + 1]);
  });
  points.push([until, greens.length]);
  return points;
}

function Crosshair(props: {
  readonly at: number;
  readonly series: readonly GreensSeries[];
  readonly x: (t: number) => number;
  readonly y: (count: number) => number;
  readonly plotTop: number;
  readonly plotH: number;
}) {
  return (
    <g pointerEvents="none">
      <line
        x1={props.x(props.at)}
        x2={props.x(props.at)}
        y1={props.plotTop}
        y2={props.plotTop + props.plotH}
        className={styles.crosshair}
      />
      {props.series.map((line) => (
        <circle
          key={line.id}
          cx={props.x(props.at)}
          cy={props.y(greensAt(line, props.at))}
          r="4"
          fill={line.color}
          className={styles.endDot}
        />
      ))}
    </g>
  );
}

function Readout(props: {
  readonly at: number;
  readonly series: readonly GreensSeries[];
  readonly left: number;
}) {
  return (
    <div className={styles.readout} style={{ left: props.left }} role="status" aria-live="polite">
      <div className={styles.readoutTime}>{formatClock(props.at)}</div>
      {props.series.map((line) => (
        <div key={line.id} className={styles.readoutRow}>
          <svg width="14" height="6" aria-hidden="true">
            <line
              x1="1"
              y1="3"
              x2="13"
              y2="3"
              stroke={line.color}
              strokeWidth="2.5"
              strokeLinecap="round"
            />
          </svg>
          <strong>{greensAt(line, props.at)}</strong>
          <span>{line.label}</span>
        </div>
      ))}
    </div>
  );
}

function GreensTable(props: {
  readonly id: string;
  readonly series: readonly GreensSeries[];
  readonly marks: readonly number[];
}) {
  return (
    <table id={props.id} className={styles.table}>
      <caption className="visually-hidden">Minutes to the k-th green</caption>
      <thead>
        <tr>
          <th scope="col">Green</th>
          {props.series.map((line) => (
            <th key={line.id} scope="col">
              {line.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[...props.marks, 0].map((count) => (
          <tr key={count}>
            <th scope="row">{count === 0 ? 'Done' : ordinal(count)}</th>
            {props.series.map((line) => {
              const t = count === 0 ? line.endedAt : line.greens[count - 1];
              return (
                <td key={line.id} className="tabular">
                  {t === undefined || t === null ? 'not reached' : formatMinutes(t)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function greensAt(line: GreensSeries, t: number): number {
  return line.greens.filter((green) => green <= t).length;
}

function summary(series: readonly GreensSeries[], beans: number): string {
  return series
    .map((line) => {
      const done =
        line.endedAt === null ? 'still racing' : `done at ${formatMinutes(line.endedAt)}`;
      return `${line.label}: ${line.greens.length} of ${beans} green, ${done}`;
    })
    .join('; ');
}
