'use client';

/**
 * `useActionState` for a settings form with uncontrolled fields. React resets a form after its
 * action runs, back to each field's `defaultValue`; those come from the page's props, which a
 * server action does not refresh, so a saved form showed the old values again and the next Save
 * sent them back (found on staging 2026-10-10: a repository description vanished on the next
 * save), and a refused form lost what was typed. This keeps the last submitted fields so the
 * defaults follow them: what was saved, or what was refused and needs fixing.
 */
import { useActionState, useState } from 'react';

export function useSavedForm<State>(
  action: (previous: Awaited<State>, form: FormData) => Promise<State>,
  initial: Awaited<State>,
): {
  readonly state: Awaited<State>;
  readonly action: (form: FormData) => void;
  readonly pending: boolean;
  /** A field as last submitted, else `fallback` (the page's value). */
  readonly saved: (name: string, fallback: string) => string;
  /** A checkbox as last submitted (`on`), else `fallback`. */
  readonly savedChecked: (name: string, fallback: boolean) => boolean;
} {
  const [submitted, setSubmitted] = useState<FormData | null>(null);
  const [state, formAction, pending] = useActionState<State, FormData>(
    async (previous: Awaited<State>, form: FormData): Promise<State> => {
      const next = await action(previous, form);
      setSubmitted(form);
      return next;
    },
    initial,
  );
  const saved = (name: string, fallback: string): string => {
    const value = submitted?.get(name);
    return typeof value === 'string' ? value : fallback;
  };
  const savedChecked = (name: string, fallback: boolean): boolean =>
    submitted === null ? fallback : submitted.get(name) === 'on';
  return { state, action: formAction, pending, saved, savedChecked };
}
