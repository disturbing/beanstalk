/** Picks the picker from configuration: Jev when `PICKER` is `jev` and an AI binding is there. */
import type { JevRunner, Picker } from './picker';
import { JEV_BUDGET_MS, JEV_MODEL, jevPicker, rulesPicker } from './picker';

export type PickerConfig = {
  /** `jev` or `rules` (the `PICKER` var). */
  readonly name: string;
  /** The optional `AI` binding. */
  readonly ai: unknown;
  /** AI Gateway id for Jev's calls (the `JEV_GATEWAY` var); empty for none. */
  readonly gateway: string;
  readonly onError?: (decision: string, error: unknown) => void;
};

export function pickerFrom(config: PickerConfig): Picker {
  if (config.name !== 'jev' || !isJevRunner(config.ai)) return rulesPicker;
  return jevPicker(config.ai, {
    model: JEV_MODEL,
    gateway: config.gateway === '' ? null : config.gateway,
    budgetMs: JEV_BUDGET_MS,
    ...(config.onError === undefined ? {} : { onError: config.onError }),
  });
}

function isJevRunner(value: unknown): value is JevRunner {
  return (
    typeof value === 'object' && value !== null && typeof Reflect.get(value, 'run') === 'function'
  );
}
