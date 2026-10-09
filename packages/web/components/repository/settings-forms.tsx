'use client';

import { useActionState } from 'react';

import type { SettingsState } from '../../src/repositories/flows';
import { EMPTY_SETTINGS_STATE } from '../../src/repositories/flows';
import {
  archiveRepository,
  deleteRepository,
  updateRepository,
} from '../../src/server/repository-actions';
import { ConfirmSubmit } from '../settings/confirm-submit';
import { useSavedForm } from '../settings/use-saved-form';
import styles from './repository.module.css';

type Repo = {
  readonly id: string;
  readonly owner: string;
  readonly name: string;
  readonly description: string;
  readonly visibility: 'public' | 'private' | 'internal';
  /** Only an organization's repository can be internal. */
  readonly ownerKind: 'user' | 'org';
  readonly website: string;
  readonly topics: readonly string[];
};

/** General (name, description, website, topics) and visibility, each saved on its own. */
export function GeneralSettings({
  repo,
  saved,
}: {
  readonly repo: Repo;
  readonly saved: string | null;
}) {
  const {
    state,
    action,
    pending,
    saved: last,
  } = useSavedForm(updateRepository, { ...EMPTY_SETTINGS_STATE, saved });
  return (
    <form
      action={action}
      className={`${styles.panel} ${styles.settingsSection}`}
      aria-labelledby="general-title"
    >
      <h2 id="general-title">Name, description and topics</h2>
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
          defaultValue={last('description', repo.description)}
          maxLength={350}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="settings-website" className={styles.label}>
          Website
        </label>
        <input
          id="settings-website"
          name="website"
          className={styles.input}
          defaultValue={last('website', repo.website)}
          inputMode="url"
          placeholder="https://"
          spellCheck={false}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="settings-topics" className={styles.label}>
          Topics
        </label>
        <input
          id="settings-topics"
          name="topics"
          className={styles.input}
          defaultValue={last('topics', repo.topics.join(', '))}
          spellCheck={false}
          aria-describedby="settings-topics-hint"
        />
        <span id="settings-topics-hint" className={styles.hint}>
          Up to 20, separated by commas: lowercase letters, digits and hyphens.
        </span>
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
  const { state, action, pending, saved } = useSavedForm(updateRepository, EMPTY_SETTINGS_STATE);
  const visibility = saved('visibility', repo.visibility);
  return (
    <form
      action={action}
      className={`${styles.panel} ${styles.settingsSection}`}
      aria-labelledby="visibility-title"
    >
      <h2 id="visibility-title">Who can read it</h2>
      <input type="hidden" name="repoId" value={repo.id} />
      <input type="hidden" name="currentName" value={repo.name} />
      <fieldset className={styles.choices}>
        <legend className="visually-hidden">Who can read it</legend>
        <label className={styles.choice}>
          <input
            type="radio"
            name="visibility"
            value="private"
            defaultChecked={visibility === 'private'}
          />
          <span>
            <b>Private</b>
            <span>
              {repo.ownerKind === 'org'
                ? "Only the people invited to it, and the organization's owners and admins, can see it."
                : 'Only you and the people you invite can see it.'}
            </span>
          </span>
        </label>
        {repo.ownerKind === 'org' ? (
          <label className={styles.choice}>
            <input
              type="radio"
              name="visibility"
              value="internal"
              defaultChecked={visibility === 'internal'}
            />
            <span>
              <b>Internal</b>
              <span>
                Every member of {repo.owner} can read and clone it; everyone else gets not found.
                Pushing still needs a role.
              </span>
            </span>
          </label>
        ) : null}
        <label className={styles.choice}>
          <input
            type="radio"
            name="visibility"
            value="public"
            defaultChecked={visibility === 'public'}
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

/**
 * Archive or unarchive. Archived: read-only (clones and fetches work; pushes, decisions and
 * deploy tokens are refused) and out of Home's lists; unarchive brings everything back.
 */
export function ArchiveSettings({
  repo,
  archivedAt,
  saved,
}: {
  readonly repo: Repo;
  readonly archivedAt: string | null;
  readonly saved: string | null;
}) {
  const [state, action, pending] = useActionState<SettingsState, FormData>(archiveRepository, {
    ...EMPTY_SETTINGS_STATE,
    saved,
  });
  const isArchived = archivedAt !== null;
  return (
    <form
      action={action}
      className={`${styles.panel} ${styles.settingsSection}`}
      aria-labelledby="archive-title"
    >
      <h2 id="archive-title">{isArchived ? 'This repository is archived' : 'Archive'}</h2>
      <p className={styles.sub}>
        {isArchived
          ? `Archived ${archivedAt.slice(0, 10)}. It is read-only: it still clones and fetches, but pushes, decision answers and deploy tokens are refused, and it is left out of Home. Its name, description and visibility are fixed until you unarchive it.`
          : 'Make it read-only: it still clones and fetches, but pushes, decision answers and deploy tokens are refused, and it leaves Home. Your page lists it under Archived, and you can unarchive it at any time.'}
      </p>
      <input type="hidden" name="repoId" value={repo.id} />
      <input type="hidden" name="to" value={isArchived ? 'active' : 'archived'} />
      <Status state={state} />
      <div className={styles.actions}>
        {isArchived ? (
          <button type="submit" className={styles.secondary} disabled={pending}>
            Unarchive
          </button>
        ) : (
          <ConfirmSubmit
            label={`Archive ${repo.owner}/${repo.name}`}
            title={`Archive ${repo.owner}/${repo.name}?`}
            confirmLabel="Archive"
            tone="danger"
            buttonClassName={styles.secondary}
            confirmClassName={styles.danger}
            disabled={pending}
          >
            <p>
              Pushes, decision answers and deploy tokens stop at once; clones and fetches keep
              working. You can unarchive it here at any time.
            </p>
          </ConfirmSubmit>
        )}
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
