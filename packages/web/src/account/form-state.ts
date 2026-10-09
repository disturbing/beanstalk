/** A settings form's result: what was saved, or what went wrong. Shared by client and server. */
export type FormState = { readonly saved: string | null; readonly error: string | null };

export const EMPTY_FORM_STATE: FormState = { saved: null, error: null };
