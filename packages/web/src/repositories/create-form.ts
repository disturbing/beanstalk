/**
 * The "New repository" form: FormData in, a valid `CreateRepositoryInput` or the message for
 * each field out, so the page can show errors beside the fields and keep what was typed.
 */
import type { CreateRepositoryInput } from '@gitstalk/shared-race/repos';
import {
  ImportUrl,
  MAX_REPO_DESCRIPTION,
  RepoName,
  RepoTemplate,
  RepoVisibility,
} from '@gitstalk/shared-race/repos';

export type CreateField = 'owner' | 'name' | 'description' | 'visibility' | 'start' | 'importUrl';

/** What the person typed, echoed back when the form is shown again. */
export type CreateValues = Readonly<Record<CreateField, string>>;

export type CreateFormResult =
  | { readonly ok: true; readonly input: CreateRepositoryInput }
  | {
      readonly ok: false;
      readonly values: CreateValues;
      readonly errors: Readonly<Partial<Record<CreateField | 'form', string>>>;
    };

export const DEFAULT_VALUES: CreateValues = {
  owner: '',
  name: '',
  description: '',
  visibility: 'private',
  start: 'template:typescript-starter',
  importUrl: '',
};

export function readCreateForm(form: FormData): CreateFormResult {
  const values = valuesOf(form);
  const errors: Partial<Record<CreateField, string>> = {};
  const name = RepoName.safeParse(values.name);
  if (!name.success) errors.name = name.error.issues[0]?.message ?? 'Check the name.';
  if (values.description.length > MAX_REPO_DESCRIPTION)
    errors.description = `Keep the description under ${MAX_REPO_DESCRIPTION + 1} characters.`;
  const visibility = RepoVisibility.safeParse(values.visibility);
  if (!visibility.success) errors.visibility = 'Choose public, private or internal.';
  const start = startOf(values);
  if (typeof start === 'string') errors[values.start === 'import' ? 'importUrl' : 'start'] = start;
  if (!name.success || !visibility.success || typeof start === 'string' || errors.description)
    return { ok: false, values, errors };
  return {
    ok: true,
    input: {
      ...(values.owner === '' ? {} : { owner: values.owner }),
      name: name.data,
      description: values.description,
      visibility: visibility.data,
      start,
    },
  };
}

function startOf(values: CreateValues): CreateRepositoryInput['start'] | string {
  if (values.start === 'empty') return { kind: 'empty' };
  if (values.start === 'import') {
    const url = ImportUrl.safeParse(values.importUrl);
    return url.success
      ? { kind: 'import', url: url.data }
      : (url.error.issues[0]?.message ?? 'Check the URL.');
  }
  const template = RepoTemplate.safeParse(values.start.replace(/^template:/, ''));
  return template.success ? { kind: 'template', template: template.data } : 'Choose how to start.';
}

function valuesOf(form: FormData): CreateValues {
  const text = (field: CreateField): string => {
    const value = form.get(field);
    return typeof value === 'string' ? value.trim() : DEFAULT_VALUES[field];
  };
  return {
    owner: text('owner'),
    name: text('name'),
    description: text('description'),
    visibility: text('visibility'),
    start: text('start'),
    importUrl: text('importUrl'),
  };
}
