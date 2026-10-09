/**
 * Repository Settings → Actions: the knobs Actions reads from repository variables, as one
 * form. The dependency cache (`BEANSTALK_DEPS_CACHE=off` turns it off, docs/claude-opus/27),
 * its snapshot cap (`BEANSTALK_DEPS_SNAPSHOT_MAX`, e.g. `2GiB`) and npm's install-time audit
 * (`BEANSTALK_NPM_AUDIT=on` turns it back on, doc 27 §12). A default is stored as no variable.
 */
import { z } from 'zod';

export const DEPS_CACHE_VARIABLE = 'BEANSTALK_DEPS_CACHE';
export const DEPS_SNAPSHOT_MAX_VARIABLE = 'BEANSTALK_DEPS_SNAPSHOT_MAX';
export const NPM_AUDIT_VARIABLE = 'BEANSTALK_NPM_AUDIT';

/** The sizes the executor's `parseSize` accepts: a number and an optional unit. */
const SIZE = /^\s*\d+(?:\.\d+)?\s*(?:b|kb|kib|mb|mib|gb|gib|tb|tib)?\s*$/i;

export const ActionsSwitches = z.strictObject({
  depsCache: z.enum(['on', 'off']),
  snapshotMax: z
    .string()
    .trim()
    .max(20)
    .refine((value) => value === '' || SIZE.test(value), 'A size such as 2GiB or 500MB.'),
  npmAudit: z.enum(['on', 'off']),
});
export type ActionsSwitches = z.infer<typeof ActionsSwitches>;

export type VariableWrites = {
  readonly put: readonly { readonly name: string; readonly value: string }[];
  readonly remove: readonly string[];
};

/** The switches as the repository's own variables set them (absent: the default). */
export function switchesOf(
  own: readonly { readonly name: string; readonly value: string }[],
): ActionsSwitches {
  const value = (name: string) => own.find((variable) => variable.name === name)?.value.trim();
  const isOff = /^(off|false|0|no|disabled)$/i.test(value(DEPS_CACHE_VARIABLE) ?? '');
  const isAuditOn = /^(on|true|1|yes)$/i.test(value(NPM_AUDIT_VARIABLE) ?? '');
  return {
    depsCache: isOff ? 'off' : 'on',
    snapshotMax: value(DEPS_SNAPSHOT_MAX_VARIABLE) ?? '',
    npmAudit: isAuditOn ? 'on' : 'off',
  };
}

/** The form's fields (`depsCache`, `snapshotMax`, `npmAudit`), checked. */
export function readSwitchesForm(
  form: FormData,
):
  | { readonly ok: true; readonly value: ActionsSwitches }
  | { readonly ok: false; readonly message: string } {
  const parsed = ActionsSwitches.safeParse({
    depsCache: form.get('depsCache') === 'on' ? 'on' : 'off',
    snapshotMax: typeof form.get('snapshotMax') === 'string' ? form.get('snapshotMax') : '',
    npmAudit: form.get('npmAudit') === 'on' ? 'on' : 'off',
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Check the form.' };
  return { ok: true, value: parsed.data };
}

/**
 * The variable changes that take `own` (the repository's variables now) to `next`: a default
 * removes the variable when the repository has one, anything else sets it.
 */
export function switchWrites(
  own: readonly { readonly name: string }[],
  next: ActionsSwitches,
): VariableWrites {
  const has = (name: string) => own.some((variable) => variable.name === name);
  const wanted: readonly (readonly [string, string | null])[] = [
    [DEPS_CACHE_VARIABLE, next.depsCache === 'off' ? 'off' : null],
    [DEPS_SNAPSHOT_MAX_VARIABLE, next.snapshotMax === '' ? null : next.snapshotMax],
    [NPM_AUDIT_VARIABLE, next.npmAudit === 'on' ? 'on' : null],
  ];
  return {
    put: wanted.flatMap(([name, value]) => (value === null ? [] : [{ name, value }])),
    remove: wanted.flatMap(([name, value]) => (value === null && has(name) ? [name] : [])),
  };
}
