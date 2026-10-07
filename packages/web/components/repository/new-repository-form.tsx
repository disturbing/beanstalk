'use client';

import { useActionState, useState } from 'react';

import type { CreateState } from '../../src/repositories/flows';
import { EMPTY_CREATE_STATE } from '../../src/repositories/flows';
import { createRepository } from '../../src/server/repository-actions';
import styles from './repository.module.css';

const STARTS = [
  {
    value: 'template:typescript-starter',
    title: 'TypeScript starter',
    detail: 'A small library with tests and a check, so the first bean is checked for real.',
  },
  { value: 'empty', title: 'Empty', detail: 'A README and nothing else.' },
  {
    value: 'import',
    title: 'Import a public git repository',
    detail: 'Its default branch becomes the stalk.',
  },
] as const;

/** New repository: name, description, visibility, and how it starts. */
export function NewRepositoryForm(props: { readonly owner: string }) {
  const [state, action, pending] = useActionState<CreateState, FormData>(
    createRepository,
    EMPTY_CREATE_STATE,
  );
  const [start, setStart] = useState<string>(state.values.start);
  const { errors, values } = state;
  return (
    <form action={action} className={styles.form} noValidate>
      {errors.form === undefined ? null : (
        <p className={styles.notice} role="alert">
          {errors.form}
        </p>
      )}
      <div className={styles.field}>
        <label htmlFor="repo-name" className={styles.label}>
          Name
        </label>
        <div className={styles.nameRow}>
          <span className={styles.owner}>{props.owner} /</span>
          <input
            id="repo-name"
            name="name"
            className={styles.input}
            defaultValue={values.name}
            required
            maxLength={63}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={errors.name === undefined ? undefined : true}
            aria-describedby="repo-name-hint"
          />
        </div>
        <span
          id="repo-name-hint"
          className={errors.name === undefined ? styles.hint : styles.error}
        >
          {errors.name ??
            'Letters, digits, ".", "-" and "_", starting with a letter or digit. It is part of the clone URL.'}
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor="repo-description" className={styles.label}>
          Description <span className={styles.muted}>(optional)</span>
        </label>
        <input
          id="repo-description"
          name="description"
          className={styles.input}
          defaultValue={values.description}
          maxLength={350}
        />
        {errors.description === undefined ? null : (
          <span className={styles.error}>{errors.description}</span>
        )}
      </div>
      <fieldset className={styles.choices}>
        <legend>Visibility</legend>
        <label className={styles.choice}>
          <input
            type="radio"
            name="visibility"
            value="private"
            defaultChecked={values.visibility !== 'public'}
          />
          <span>
            <b>Private</b>
            <span>Only you can see it.</span>
          </span>
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            name="visibility"
            value="public"
            defaultChecked={values.visibility === 'public'}
          />
          <span>
            <b>Public</b>
            <span>Anyone with the link can read it. Only you and your agents change it.</span>
          </span>
        </label>
      </fieldset>
      <fieldset className={styles.choices}>
        <legend>Start with</legend>
        {STARTS.map((choice) => (
          <label key={choice.value} className={styles.choice}>
            <input
              type="radio"
              name="start"
              value={choice.value}
              checked={start === choice.value}
              onChange={() => setStart(choice.value)}
            />
            <span>
              <b>{choice.title}</b>
              <span>{choice.detail}</span>
              {choice.value === 'import' && start === 'import' ? (
                <span className={styles.importUrl}>
                  <input
                    name="importUrl"
                    className={styles.input}
                    defaultValue={values.importUrl}
                    placeholder="https://github.com/owner/repo.git"
                    aria-label="Public git URL"
                    aria-invalid={errors.importUrl === undefined ? undefined : true}
                    spellCheck={false}
                  />
                  {errors.importUrl === undefined ? null : (
                    <span className={styles.error}>{errors.importUrl}</span>
                  )}
                </span>
              ) : null}
            </span>
          </label>
        ))}
        {errors.start === undefined ? null : <span className={styles.error}>{errors.start}</span>}
      </fieldset>
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Creating repository…' : 'Create repository'}
        </button>
        <span className={styles.hint}>An import can take a minute for a large repository.</span>
      </div>
    </form>
  );
}
