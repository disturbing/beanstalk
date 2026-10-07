/**
 * Who pushed each bean of a repository: the gateway's `pushedBeans` (the push records the
 * credential's handle), validated before the page trusts it. A repository page names the
 * person (`@coop`) where a race names its agent slot (`a0`).
 */
import { z } from 'zod';

import type { Pushers } from '@beanstalk/shared-ask/home/sessions';
import { log } from '../log';

const PushedBeans = z.array(z.object({ bean: z.string(), actor: z.string() }));
const PushedBeansResult = z.union([
  z.object({ ok: z.literal(true), value: PushedBeans }),
  z.object({ ok: z.literal(false) }),
]);

/**
 * The pushers of an engine's beans. Anything but a valid answer (an older gateway, an engine
 * that is not a repository's, a failure) reads as "nobody pushed": the page then falls back
 * to the engine's own wording rather than failing.
 */
export async function pushersOf(binding: object, engineId: string): Promise<Pushers> {
  const method: unknown = Reflect.get(binding, 'pushedBeans');
  if (typeof method !== 'function') return {};
  try {
    const answer: unknown = await Reflect.apply(method, binding, [engineId]);
    const parsed = PushedBeansResult.safeParse(answer);
    if (!parsed.success || !parsed.data.ok) return {};
    return Object.fromEntries(parsed.data.value.map((bean) => [bean.bean, bean.actor]));
  } catch (error: unknown) {
    log.warn('pushed beans unreadable; the page names no pushers', { engineId, error });
    return {};
  }
}
