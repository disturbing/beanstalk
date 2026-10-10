/**
 * The bean a recent-change answer features (its journey): the newest landed bean of the rail
 * that touches the answer's files, with its own change's files.
 */
import type { RunId, TaskId } from '@gitstalk/shared-race/ids';

import type { Answer } from '@gitstalk/shared-ask/ask/answer';
import type { ForgeSource } from '@gitstalk/shared-ask/forge/forge-source';

/** Classes whose answer is about recent change: feature the newest bean it is about. */
const FEATURE_CLASSES = new Set(['recent-changes', 'who-why']);

export async function featuredBean(
  source: ForgeSource,
  run: RunId,
  answer: Answer,
  selected: TaskId | null,
) {
  if (selected !== null || !FEATURE_CLASSES.has(answer.spec.class)) return null;
  const wanted = new Set(answer.tree.matched);
  const newest = answer.rail
    .flatMap((block) => (block.kind === 'beans' ? block.beans : []))
    .filter((bean) => bean.landedIdx !== null && bean.files.some((file) => wanted.has(file)))
    .toSorted((a, b) => (b.landedIdx ?? 0) - (a.landedIdx ?? 0))[0];
  if (newest === undefined) return null;
  const detail = await source.beanDetail(run, newest.id);
  if (detail === undefined) return null;
  const diff =
    detail.diffBase === null || detail.diffHead === null
      ? null
      : await source.repoDiff(run, detail.diffBase, detail.diffHead);
  return { bean: detail, files: diff?.files ?? [] };
}
