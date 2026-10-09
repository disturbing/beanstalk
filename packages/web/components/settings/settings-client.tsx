'use client';

/**
 * The two bits of the settings pages that need the browser: keeping the current section in
 * view in the phone's sideways nav, and moving an old one-page anchor (`#social`, `#secrets`)
 * to its own page. Both are progressive: without script the pages work as plain links.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';

import { anchorTarget } from '../../src/settings/sections';

/** Wraps the nav; on narrow screens scrolls the current link into the middle of the strip. */
export function CurrentInView(props: {
  readonly className: string | undefined;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = ref.current;
    const current = strip?.querySelector<HTMLElement>('[aria-current="page"]');
    if (strip === null || current === null || current === undefined) return;
    if (strip.scrollWidth <= strip.clientWidth) return;
    const stripBox = strip.getBoundingClientRect();
    const currentBox = current.getBoundingClientRect();
    strip.scrollLeft +=
      currentBox.left - stripBox.left - (strip.clientWidth - currentBox.width) / 2;
  }, []);
  return (
    <div ref={ref} className={props.className}>
      {props.children}
    </div>
  );
}

/**
 * When the URL's anchor names a section of the old one-page settings that now has its own
 * page, replaces the location with that page (keeping the query and the anchor).
 */
export function LegacyAnchor(props: {
  readonly anchors: Readonly<Record<string, string>>;
  readonly current: string;
  /** The settings base: `/<owner>/<repo>/settings` or `/orgs/<org>/settings`. */
  readonly base: string;
  /** The sections this viewer may open; others stay put. */
  readonly allowed: readonly string[];
}) {
  const { anchors, current, base, allowed } = props;
  useEffect(() => {
    const target = anchorTarget(anchors, window.location.hash, current);
    if (target === null || !allowed.includes(target)) return;
    window.location.replace(`${base}/${target}${window.location.search}${window.location.hash}`);
  }, [anchors, current, base, allowed]);
  return null;
}
