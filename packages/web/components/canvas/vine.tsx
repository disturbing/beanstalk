'use client';

import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import type { Batch, LineCommit, RaceState } from '../../src/race/race-state';
import { formatClock } from '../../src/race/race-format';
import { useElementWidth } from '../race/use-element-width';
import styles from './canvas.module.css';

const STEP = 30;
const MARGIN = 28;
const HEIGHT = 168;
const MID = 74;
const LEAF = 23;

type Point = { readonly x: number; readonly y: number };

/**
 * The sprout and the stalk as a growing vine: every commit of the line is a bead, the stalk
 * is the thick verified stem and the sprout the young tip beyond it. Beads are green on the
 * stalk, ringed while they wait for validation, amber while validating, red where a
 * validation failed, grey when reverted.
 */
export function Vine(props: {
  readonly run: string;
  readonly state: RaceState;
  readonly titles: Readonly<Record<string, string>>;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const available = useElementWidth(scroller) ?? 900;
  const commits = props.state.line.commits;
  const isQueue = props.state.meta?.policy === 'queue';
  const width = Math.max(available, MARGIN * 2 + (commits.length + 2) * STEP);
  const points = commits.map((_, index) => stemPoint(index));
  const stalkAt = isQueue ? commits.length - 1 : props.state.line.stalkIdx;
  const [active, setActive] = useState<number | null>(null);
  const current = Math.min(active ?? commits.length - 1, commits.length - 1);
  const svg = useRef<SVGSVGElement>(null);

  /** One tab stop for the whole vine; the arrow keys walk along it (roving tabindex). */
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const next = nextBead(event.key, current, commits.length);
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
    svg.current?.querySelectorAll<SVGAElement>('a')[next]?.focus();
  };

  useEffect(() => {
    const element = scroller.current;
    if (element !== null) element.scrollLeft = element.scrollWidth;
  }, [commits.length]);

  return (
    <div ref={scroller} className={styles.vineScroll}>
      <svg
        ref={svg}
        width={width}
        height={HEIGHT}
        className={styles.vine}
        role="group"
        aria-label={`${vineSummary(commits.length, stalkAt, isQueue)} Use the arrow keys to move between commits.`}
        onKeyDown={onKeyDown}
      >
        <Stems points={points} stalkAt={stalkAt} isQueue={isQueue} />
        {commits.map((commit, index) => (
          <Bead
            key={commit.sha}
            commit={commit}
            at={points[index] ?? stemPoint(index)}
            side={index % 2 === 0 ? -1 : 1}
            run={props.run}
            title={commit.task === null ? commit.kind : (props.titles[commit.task] ?? commit.task)}
            focusable={index === current}
            onFocus={() => setActive(index)}
          />
        ))}
        {isQueue ? <RedBuds batches={props.state.batches} commits={commits} /> : null}
        <Pointers commits={commits} stalkAt={stalkAt} isQueue={isQueue} />
      </svg>
      {commits.length === 0 ? (
        <p className={styles.vineEmpty}>
          Nothing has landed yet: the line is still its base commit.
        </p>
      ) : null}
    </div>
  );
}

function nextBead(key: string, current: number, count: number): number | undefined {
  if (count === 0) return undefined;
  if (key === 'ArrowRight' || key === 'ArrowDown') return Math.min(count - 1, current + 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp') return Math.max(0, current - 1);
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return undefined;
}

function stemPoint(index: number): Point {
  return { x: MARGIN + 24 + index * STEP, y: MID + Math.sin(index * 0.85) * 6 };
}

function Stems(props: {
  readonly points: readonly Point[];
  readonly stalkAt: number;
  readonly isQueue: boolean;
}) {
  const root = { x: MARGIN - 4, y: MID + 4 };
  const last = props.points.at(-1);
  if (last === undefined) {
    return (
      <path d={smoothPath([root, { x: root.x + 40, y: MID - 4 }])} className={styles.groundStem} />
    );
  }
  const tip = { x: last.x + STEP * 0.9, y: last.y - 10 };
  const stalkEnd = props.stalkAt < 0 ? 0 : props.stalkAt + 1;
  const stalk = [root, ...props.points.slice(0, stalkEnd)];
  const sprout = [stalk.at(-1) ?? root, ...props.points.slice(stalkEnd), tip];
  return (
    <g>
      {props.isQueue ? null : <path d={smoothPath(sprout)} className={styles.sproutStem} />}
      {props.isQueue ? null : <Tendril at={tip} />}
      {stalk.length > 1 ? (
        <path
          d={smoothPath(props.isQueue ? [...stalk, tip] : stalk)}
          className={styles.stalkStem}
        />
      ) : null}
    </g>
  );
}

function Tendril({ at }: { readonly at: Point }) {
  const d = `M${at.x},${at.y} c 6,-4 11,-1 10,5 c -1,5 -7,5 -7,1 c 0,-3 3,-3 4,-1`;
  return <path d={d} className={`${styles.sproutStem} ${styles.tendril}`} />;
}

/** Catmull-Rom through the points, as cubic Béziers. */
function smoothPath(points: readonly Point[]): string {
  const first = points[0];
  if (first === undefined) return '';
  const segments = points.slice(1).map((point, index) => {
    const p0 = points[index - 1] ?? points[index] ?? point;
    const p1 = points[index] ?? point;
    const p3 = points[index + 2] ?? point;
    const c1 = { x: p1.x + (point.x - p0.x) / 6, y: p1.y + (point.y - p0.y) / 6 };
    const c2 = { x: point.x - (p3.x - p1.x) / 6, y: point.y - (p3.y - p1.y) / 6 };
    return `C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  });
  return `M${first.x.toFixed(1)},${first.y.toFixed(1)} ${segments.join(' ')}`;
}

const BEAD_CLASS: Readonly<Record<LineCommit['status'], string | undefined>> = {
  green: styles.beadGreen,
  pending: styles.beadPending,
  validating: styles.beadValidating,
  red: styles.beadRed,
  culprit: styles.beadCulprit,
  reverted: styles.beadReverted,
};

const STATUS_WORDS: Readonly<Record<LineCommit['status'], string>> = {
  green: 'on the stalk',
  pending: 'on the sprout, waiting for validation',
  validating: 'being validated',
  red: 'a validation ending here went red',
  culprit: 'blamed for a red validation',
  reverted: 'reverted',
};

function Bead(props: {
  readonly commit: LineCommit;
  readonly at: Point;
  readonly side: -1 | 1;
  readonly run: string;
  readonly title: string;
  readonly focusable: boolean;
  readonly onFocus: () => void;
}) {
  const { commit, at, side } = props;
  const bead = { x: at.x, y: at.y + side * LEAF };
  const label = `${commit.task ?? commit.kind}: ${props.title}. #${commit.idx}, ${STATUS_WORDS[commit.status]}, landed at ${formatClock(commit.t)}.`;
  const href =
    commit.task === null ? `/runs/${props.run}` : `/runs/${props.run}?bean=${commit.task}`;
  return (
    <a
      href={href}
      className={styles.beadLink}
      aria-label={label}
      tabIndex={props.focusable ? 0 : -1}
      onFocus={props.onFocus}
    >
      <title>{label}</title>
      <line x1={at.x} y1={at.y} x2={bead.x} y2={bead.y - side * 7} className={styles.petiole} />
      <circle cx={bead.x} cy={bead.y} r="7.5" className={BEAD_CLASS[commit.status]} />
      {commit.status === 'validating' ? (
        <circle cx={bead.x} cy={bead.y} r="7.5" className={styles.pulse} />
      ) : null}
      <BeadGlyph status={commit.status} at={bead} />
      <text x={bead.x} y={bead.y + side * 18 + 3} textAnchor="middle" className={styles.beadLabel}>
        {commit.task ?? commit.kind}
      </text>
    </a>
  );
}

function BeadGlyph({ status, at }: { readonly status: LineCommit['status']; readonly at: Point }) {
  if (status === 'red' || status === 'culprit') {
    return <path d={`M${at.x - 3},${at.y - 3} l6,6 m0,-6 l-6,6`} className={styles.beadGlyph} />;
  }
  if (status === 'reverted')
    return <path d={`M${at.x - 3.5},${at.y + 3.5} l7,-7`} className={styles.beadGlyph} />;
  return null;
}

/** queue: red batches hang off the stalk where they were tested, as withered buds. */
function RedBuds(props: {
  readonly batches: readonly Batch[];
  readonly commits: readonly LineCommit[];
}) {
  const red = props.batches.filter((batch) => batch.status === 'red');
  const stacks = new Map<number, number>();
  return (
    <g>
      {red.map((batch) => {
        const position = props.commits.filter((commit) => commit.t <= batch.startedAt).length;
        const depth = stacks.get(position) ?? 0;
        stacks.set(position, depth + 1);
        const x = MARGIN + 24 + (position - 0.5) * STEP;
        const y = MID + 44 + depth * 13;
        return (
          <g key={batch.batch}>
            <title>{`Batch ${batch.batch} red: ${batch.tasks.join(', ')}${batch.culprit === null ? '' : `; culprit ${batch.culprit}`}`}</title>
            <path d={`M${x},${y - 5} l5,5 l-5,5 l-5,-5 Z`} className={styles.bud} />
          </g>
        );
      })}
    </g>
  );
}

function Pointers(props: {
  readonly commits: readonly LineCommit[];
  readonly stalkAt: number;
  readonly isQueue: boolean;
}) {
  const sproutIdx = props.commits.length - 1;
  if (sproutIdx < 0) return null;
  const y = HEIGHT - 8;
  const stalkX = props.stalkAt < 0 ? MARGIN : stemPoint(props.stalkAt).x;
  const sproutX = stemPoint(sproutIdx).x;
  if (props.isQueue || props.stalkAt === sproutIdx) {
    return (
      <Pointer
        x={sproutX}
        y={y}
        text={props.isQueue ? `stalk #${sproutIdx}` : `stalk = sprout #${sproutIdx}`}
      />
    );
  }
  const apart = sproutX - stalkX > 96;
  return (
    <g>
      <Pointer
        x={stalkX}
        y={y}
        text={props.stalkAt < 0 ? 'stalk: base' : `stalk #${props.stalkAt}`}
        anchor={apart ? 'middle' : 'end'}
      />
      <Pointer
        x={sproutX}
        y={y}
        text={`sprout #${sproutIdx}`}
        anchor={apart ? 'middle' : 'start'}
      />
    </g>
  );
}

function Pointer(props: {
  readonly x: number;
  readonly y: number;
  readonly text: string;
  readonly anchor?: 'start' | 'middle' | 'end';
}) {
  const anchor = props.anchor ?? 'middle';
  const shift = { start: -6, middle: 0, end: 6 }[anchor];
  return (
    <g>
      <path d={`M${props.x},${props.y - 22} l-4,6 h8 Z`} className={styles.pointerMark} />
      <text x={props.x + shift} y={props.y} textAnchor={anchor} className={styles.pointer}>
        {props.text}
      </text>
    </g>
  );
}

function vineSummary(count: number, stalkAt: number, isQueue: boolean): string {
  if (count === 0) return 'Nothing has landed yet.';
  if (isQueue)
    return `The stalk: ${count} commits. The queue lands verified batches straight on the stalk.`;
  return `The sprout: ${count} commits. The stalk trails at ${stalkAt < 0 ? 'the base' : `#${stalkAt}`}.`;
}
