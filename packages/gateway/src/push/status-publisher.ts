/**
 * Publishes each pushed bean's verdict as a ref anyone can read with plain git:
 * `refs/beans/<name>/status`, an annotated tag on the bean's head whose message is
 * `<phase>: <reason>` and the details. Writes go one at a time, newest wins: a bean whose
 * phase changed twice while a write was in flight is written once more, with the latest.
 */
import { Sha } from '@gitstalk/shared-race/ids';

import { UpstreamError } from '../errors';
import { annotatedTag } from '../git/pack-writer';
import type { RemoteTarget } from '../git/remote-client';
import { ZERO_SHA, listRefs, pushRefs } from '../git/remote-client';
import type { Logger } from '../log';
import { beanStatusRef } from './bean-refs';
import type { PushBean } from './push-bean';
import { withoutRemotePrefix } from './push-messages';

export type StatusTag = NonNullable<PushBean['status']>;

export type StatusPublisherDeps = {
  /** The engine repo with a write token minted for it. */
  readonly target: () => Promise<RemoteTarget>;
  readonly log: Logger;
  readonly waitUntil: (work: Promise<void>) => void;
  /** Records the tag now at the bean's status ref. */
  readonly published: (bean: string, status: StatusTag) => void;
  readonly now: () => number;
};

const TAGGER = { name: 'gitstalk', email: 'engine@gitstalk.invalid' } as const;

export class StatusPublisher {
  readonly #deps: StatusPublisherDeps;
  readonly #pending = new Map<string, PushBean>();
  #running: Promise<void> | null = null;

  constructor(deps: StatusPublisherDeps) {
    this.#deps = deps;
  }

  /** Publishes the bean's phase unless its status ref already carries it. */
  publish(bean: PushBean): void {
    if (bean.status !== null && bean.status.phase === bean.phase && bean.status.head === bean.head)
      return;
    this.#pending.set(bean.bean, bean);
    if (this.#running !== null) return;
    const running = this.#drain().finally(() => {
      this.#running = null;
    });
    this.#running = running;
    this.#deps.waitUntil(running);
  }

  async #drain(): Promise<void> {
    for (;;) {
      const next = this.#pending.values().next();
      if (next.done === true) return;
      this.#pending.delete(next.value.bean);
      try {
        // oxlint-disable-next-line no-await-in-loop -- status writes go one at a time
        this.#deps.published(next.value.bean, await this.#write(next.value));
      } catch (error: unknown) {
        this.#deps.log.warn('publishing a bean status failed', { bean: next.value.bean, error });
      }
    }
  }

  async #write(bean: PushBean): Promise<StatusTag> {
    const target = await this.#deps.target();
    const tag = await annotatedTag({
      object: bean.head,
      tag: `beans/${bean.bean}/status`,
      tagger: { ...TAGGER, atMs: this.#deps.now() },
      message: statusMessage(bean),
    });
    const ref = beanStatusRef(bean.bean);
    let oldSha = bean.status?.tag ?? ZERO_SHA;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // oxlint-disable-next-line no-await-in-loop -- a stale lease is read once, then retried
      const report = await pushRefs(target, [{ ref, oldSha, newSha: tag.id }], [tag]);
      if (report.unpackOk && report.refs.every((status) => status.ok))
        return { tag: Sha.parse(tag.id), phase: bean.phase, head: bean.head };
      // oxlint-disable-next-line no-await-in-loop -- the ref's actual value for the retry
      oldSha = (await listRefs(target)).get(ref) ?? ZERO_SHA;
    }
    throw new UpstreamError(`the status ref of ${bean.bean} did not move`, true);
  }
}

/** The tag's message: the verdict line, then what a reader needs to act on it. */
export function statusMessage(bean: PushBean): string {
  const lines = [`${bean.phase}: ${bean.reason}`, '', `bean: ${bean.bean}`, `title: ${bean.title}`];
  lines.push(`head: ${bean.head}`, `push: ${bean.pushes}`);
  if (bean.task !== null) lines.push(`task: ${bean.task}`);
  if (bean.landedSha !== null) lines.push(`landed: ${bean.landedSha}`);
  if (bean.verdict !== null && bean.verdict.push === bean.pushes && bean.phase !== 'green') {
    lines.push('', ...bean.verdict.lines.map((line) => withoutRemotePrefix(line)));
  }
  return `${lines.join('\n')}\n`;
}
