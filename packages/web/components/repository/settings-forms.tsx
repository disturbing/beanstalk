'use client';

import { useActionState } from 'react';

import type { SettingsState } from '../../src/repositories/flows';
import { EMPTY_SETTINGS_STATE } from '../../src/repositories/flows';
import { deleteRepository, updateRepository } from '../../src/server/repository-actions';
import styles from './repository.module.css';

type Repo = {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: 'public' | 'private';
};

/** General (name, description) and visibility, each saved on its own. */
export function GeneralSettings({
  repo,
  saved,
}: {
  readonly repo: Repo;
  readonly saved: string | null;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(updateRepository, {
    ...EMPTY_SETTINGS_STATE,
    saved,
  });
  return (
    <form
      action={action}
      className={`${styles.panel} ${styles.settingsSection}`}
      aria-labelledby="general-title"
    >
      <h2 id="general-title">General</h2>
      <input type="hidden" name="repoId" value={repo.id} />
      <input type="hidden" name="currentName" value={repo.name} />
      <div className={styles.field}>
        <label htmlFor="settings-name" className={styles.label}>
          Name
        </label>
        <div className={styles.nameRow}>
          <span className={styles.owner}>{repo.owner} /</span>
          <input
            id="settings-name"
            name="name"
            className={styles.input}
            defaultValue={repo.name}
            required
            spellCheck={false}
          />
        </div>
        <span className={styles.hint}>
          Renaming changes the URL and the clone URL; the history stays.
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor="settings-description" className={styles.label}>
          Description
        </label>
        <input
          id="settings-description"
          name="description"
          className={styles.input}
          defaultValue={repo.description}
          maxLength={350}
        />
      </div>
      <Status state={state} />
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          Save changes
        </button>
      </div>
    </form>
  );
}

export function VisibilitySettings({ repo }: { readonly repo: Repo }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    updateRepository,
    EMPTY_SETTINGS_STATE,
  );
  return (
    <form
      action={action}
      className={`${styles.panel} ${styles.settingsSection}`}
      aria-labelledby="visibility-title"
    >
      <h2 id="visibility-title">Visibility</h2>
      <input type="hidden" name="repoId" value={repo.id} />
      <input type="hidden" name="currentName" value={repo.name} />
      <fieldset className={styles.choices}>
        <legend className="visually-hidden">Who can read it</legend>
        <label className={styles.choice}>
          <input
            type="radio"
            name="visibility"
            value="private"
            defaultChecked={repo.visibility === 'private'}
          />
          <span>
            <b>Private</b>
            <span>Only you and the people you invite can see it.</span>
          </span>
        </label>
        <label className={styles.choice}>
          <input
            type="radio"
            name="visibility"
            value="public"
            defaultChecked={repo.visibility === 'public'}
          />
          <span>
            <b>Public</b>
            <span>
              Anyone, signed in or not, can read and clone it. Pushing still needs a role.
            </span>
          </span>
        </label>
      </fieldset>
      <Status state={state} />
      <div className={styles.actions}>
        <button type="submit" className={styles.secondary} disabled={pending}>
          Change visibility
        </button>
      </div>
    </form>
  );
}

/** Delete, after typing `<owner>/<name>`. */
export function DangerZone({ repo }: { readonly repo: Repo }) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    deleteRepository,
    EMPTY_SETTINGS_STATE,
  );
  const fullName = `${repo.owner}/${repo.name}`;
  return (
    <form
      action={action}
      className={`${styles.panel} ${styles.settingsSection} ${styles.dangerZone}`}
      aria-labelledby="danger-title"
    >
      <h2 id="danger-title">Delete this repository</h2>
      <p className={styles.sub}>
        Deleting removes its history, beans and decisions for good. Agents connected to it lose
        access at once.
      </p>
      <input type="hidden" name="repoId" value={repo.id} />
      <input type="hidden" name="fullName" value={fullName} />
      <div className={styles.field}>
        <label htmlFor="confirm-delete" className={styles.label}>
          Type <code>{fullName}</code> to confirm
        </label>
        <input
          id="confirm-delete"
          name="confirm"
          className={styles.input}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <Status state={state} />
      <div className={styles.actions}>
        <button type="submit" className={styles.danger} disabled={pending}>
          Delete {fullName}
        </button>
      </div>
    </form>
  );
}

function Status({ state }: { readonly state: SettingsState }) {
  if (state.error !== null)
    return (
      <p className={styles.error} role="alert">
        {state.error}
      </p>
    );
  if (state.saved !== null)
    return (
      <p className={styles.saved} role="status">
        {state.saved}
      </p>
    );
  return null;
}
