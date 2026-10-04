/**
 * Links into the web app's explorer for the caller's run: a bean, a line, or an Ask question.
 * Links never carry the caller's token; the explorer reads runs without one.
 */
import type { RunId, TaskId } from '@beanstalk/shared-race/ids';

import type { LineRef } from '@beanstalk/shared-ask/ask/view-spec';

export type PreviewTarget =
  | { readonly kind: 'bean'; readonly bean: TaskId }
  | { readonly kind: 'ref'; readonly ref: LineRef }
  | { readonly kind: 'ask'; readonly question: string; readonly ref: LineRef | null }
  | { readonly kind: 'run' };

export type PreviewLink = {
  readonly url: string;
  readonly summary: string;
};

export function previewUrl(webUrl: string, run: RunId, target: PreviewTarget): string {
  const url = new URL(`/runs/${run}`, webUrl);
  switch (target.kind) {
    case 'bean':
      url.searchParams.set('bean', target.bean);
      break;
    case 'ref':
      url.searchParams.set('ref', target.ref);
      break;
    case 'ask':
      url.searchParams.set('q', target.question);
      if (target.ref !== null) url.searchParams.set('ref', target.ref);
      break;
    case 'run':
      break;
    default:
      return assertNever(target);
  }
  return url.toString();
}

/** `preview_link`: where a person (or a browsing agent) can see a bean or a line. */
export function previewLink(webUrl: string, run: RunId, target: PreviewTarget): PreviewLink {
  const url = previewUrl(webUrl, run, target);
  return { url, summary: `Explorer for ${describe(target)} in run ${run}.` };
}

function describe(target: PreviewTarget): string {
  switch (target.kind) {
    case 'bean':
      return `bean ${target.bean}`;
    case 'ref':
      return `the ${target.ref}`;
    case 'ask':
      return `"${target.question}"`;
    case 'run':
      return 'the repository';
    default:
      return assertNever(target);
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected preview target ${JSON.stringify(value)}`);
}
