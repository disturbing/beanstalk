/**
 * The page's picker from configuration: Jev through Workers AI and the AI Gateway when
 * `PICKER` is `jev` and the AI binding is there, otherwise the rules. Jev failures fall back
 * to the rules per decision and are logged (never with request bodies).
 */
import { env } from 'cloudflare:workers';

import type { Picker } from '@gitstalk/shared-ask/pick/picker';
import { pickerFrom } from '@gitstalk/shared-ask/pick/picker-from-env';
import { log } from '../log';

export function pagePicker(): Picker {
  return pickerFrom({
    name: env.PICKER,
    ai: Reflect.get(env, 'AI'),
    gateway: env.JEV_GATEWAY,
    onError: (decision, error) => log.warn('jev pick fell back to the rule', { decision, error }),
  });
}
