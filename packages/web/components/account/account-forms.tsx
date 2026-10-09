'use client';

/**
 * The account settings forms. Text forms are server actions with a save line under them;
 * the picture is a plain multipart POST (a file does not travel through an action) with a
 * preview and the size check done here first, so a too-large file never leaves the browser.
 */
import { useActionState, useEffect, useId, useState } from 'react';

import type { FormState } from '../../src/account/form-state';
import { EMPTY_FORM_STATE } from '../../src/account/form-state';
import type { ProfileFormState } from '../../src/server/account-actions';
import {
  changeHandleAction,
  deleteAccountAction,
  removeAvatarAction,
  renamePasskeyAction,
  saveProfile,
} from '../../src/server/account-actions';
import { SaveStatus } from '../settings/settings-shell';
import styles from './account.module.css';

const MAX_BYTES = 2 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export function ProfileForm({
  csrf,
  profile,
}: {
  readonly csrf: string;
  readonly profile: {
    readonly displayName: string;
    readonly bio: string;
    readonly website: string;
  };
}) {
  const [state, action, pending] = useActionState<ProfileFormState, FormData>(saveProfile, {
    ...EMPTY_FORM_STATE,
    field: null,
  });
  const invalid = (name: ProfileFormState['field']) => (state.field === name ? true : undefined);
  return (
    <form action={action} className={styles.tokenForm} noValidate>
      <input type="hidden" name="csrf" value={csrf} />
      <div className={styles.field}>
        <label htmlFor="profile-name" className={styles.label}>
          Name
        </label>
        <input
          id="profile-name"
          name="displayName"
          className={styles.input}
          defaultValue={profile.displayName}
          maxLength={64}
          autoComplete="name"
          aria-invalid={invalid('displayName')}
        />
        <span className={styles.hint}>
          Shown beside your handle. Leave empty to use the handle.
        </span>
      </div>
      <div className={styles.field}>
        <label htmlFor="profile-bio" className={styles.label}>
          Bio
        </label>
        <textarea
          id="profile-bio"
          name="bio"
          className={styles.input}
          defaultValue={profile.bio}
          maxLength={160}
          rows={3}
          aria-invalid={invalid('bio')}
        />
        <span className={styles.hint}>Up to 160 characters.</span>
      </div>
      <div className={styles.field}>
        <label htmlFor="profile-website" className={styles.label}>
          Website
        </label>
        <input
          id="profile-website"
          name="website"
          className={styles.input}
          defaultValue={profile.website}
          inputMode="url"
          autoComplete="url"
          placeholder="https://"
          spellCheck={false}
          aria-invalid={invalid('website')}
        />
      </div>
      <div className={styles.inline}>
        <button type="submit" className={styles.primary} disabled={pending}>
          Save profile
        </button>
        <SaveStatus pending={pending} saved={state.saved} error={state.error} />
      </div>
    </form>
  );
}

/** Upload (multipart POST to the route handler) and remove (an action). */
export function AvatarForm({
  csrf,
  hasPicture,
  note,
}: {
  readonly csrf: string;
  readonly hasPicture: boolean;
  /** What the last upload did (`?picture=` on the page). */
  readonly note: { readonly kind: 'saved' | 'error'; readonly text: string } | null;
}) {
  const inputId = useId();
  const [preview, setPreview] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [removeState, removeAction, removing] = useActionState<FormState, FormData>(
    removeAvatarAction,
    EMPTY_FORM_STATE,
  );
  useEffect(() => {
    if (removeState.saved !== null) window.location.assign('/settings?picture=removed');
  }, [removeState.saved]);
  const choose = (files: FileList | null) => {
    const file = files?.[0];
    if (file === undefined) return;
    if (file.size > MAX_BYTES) {
      setProblem('Images can be up to 2 MB. Pick a smaller one.');
      setPreview(null);
      return;
    }
    setProblem(null);
    setPreview(URL.createObjectURL(file));
  };
  return (
    <div className={styles.stack}>
      <form
        method="post"
        action="/settings/profile/avatar"
        encType="multipart/form-data"
        className={styles.inline}
      >
        <input type="hidden" name="csrf" value={csrf} />
        {preview === null ? null : (
          <img
            src={preview}
            alt="The picture you chose"
            width={64}
            height={64}
            className={styles.preview}
          />
        )}
        <label htmlFor={inputId} className="visually-hidden">
          Picture file
        </label>
        <input
          id={inputId}
          type="file"
          name="file"
          accept={ACCEPT}
          required
          className={styles.file}
          onChange={(event) => choose(event.currentTarget.files)}
        />
        <button type="submit" className={styles.secondary} disabled={problem !== null}>
          Upload picture
        </button>
      </form>
      <p className={styles.hint}>
        PNG, JPEG, WebP or GIF (first frame), up to 2 MB and 4096 pixels a side. It is cropped
        square.
      </p>
      <SaveStatus
        pending={false}
        saved={note?.kind === 'saved' ? note.text : removeState.saved}
        error={problem ?? (note?.kind === 'error' ? note.text : removeState.error)}
      />
      {hasPicture ? (
        <form action={removeAction}>
          <input type="hidden" name="csrf" value={csrf} />
          <button type="submit" className={styles.quiet} disabled={removing}>
            Remove picture (use the generated one)
          </button>
        </form>
      ) : null}
    </div>
  );
}

export function HandleForm({
  csrf,
  handle,
  isCoolingDown,
}: {
  readonly csrf: string;
  readonly handle: string;
  readonly isCoolingDown: boolean;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    changeHandleAction,
    EMPTY_FORM_STATE,
  );
  // A changed handle is in the header and every link: load the page again, not just this form.
  useEffect(() => {
    if (state.saved !== null) window.location.assign('/settings/account?saved=handle');
  }, [state.saved]);
  return (
    <form action={action} className={styles.tokenForm}>
      <input type="hidden" name="csrf" value={csrf} />
      <div className={styles.field}>
        <label htmlFor="new-handle" className={styles.label}>
          New handle
        </label>
        <div className={styles.handleField}>
          <span aria-hidden="true">@</span>
          <input
            id="new-handle"
            name="handle"
            defaultValue={handle}
            required
            minLength={2}
            maxLength={39}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="new-handle-hint"
          />
        </div>
        <span id="new-handle-hint" className={styles.hint}>
          2–39 lowercase letters, digits or single hyphens. Your page, repositories and clone URLs
          move; links and git remotes using @{handle} keep redirecting, and nobody else can take it.
          One change a day.
        </span>
      </div>
      <div className={styles.inline}>
        <button type="submit" className={styles.secondary} disabled={pending || isCoolingDown}>
          Change handle
        </button>
        <SaveStatus pending={pending} saved={state.saved} error={state.error} />
      </div>
    </form>
  );
}

export function DeleteAccountForm({
  csrf,
  handle,
  blocked,
}: {
  readonly csrf: string;
  readonly handle: string;
  /** Why deletion is refused now (sole owner of an organisation), or null. */
  readonly blocked: string | null;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    deleteAccountAction,
    EMPTY_FORM_STATE,
  );
  useEffect(() => {
    if (state.saved !== null) window.location.assign('/?account=deleted');
  }, [state.saved]);
  return (
    <form action={action} className={styles.tokenForm}>
      <input type="hidden" name="csrf" value={csrf} />
      <div className={styles.field}>
        <label htmlFor="confirm-account-delete" className={styles.label}>
          Type <code>{handle}</code> to confirm
        </label>
        <input
          id="confirm-account-delete"
          name="confirm"
          className={styles.input}
          autoComplete="off"
          spellCheck={false}
          disabled={blocked !== null}
        />
      </div>
      <div className={styles.inline}>
        <button type="submit" className={styles.danger} disabled={pending || blocked !== null}>
          Delete my account
        </button>
        <SaveStatus pending={pending} saved={null} error={blocked ?? state.error} />
      </div>
    </form>
  );
}

export function PasskeyRename({
  csrf,
  passkey,
}: {
  readonly csrf: string;
  readonly passkey: { readonly id: string; readonly name: string };
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    renamePasskeyAction,
    EMPTY_FORM_STATE,
  );
  const inputId = useId();
  return (
    <form action={action} className={styles.renameRow}>
      <input type="hidden" name="csrf" value={csrf} />
      <input type="hidden" name="passkey" value={passkey.id} />
      <label htmlFor={inputId} className="visually-hidden">
        Name of {passkey.name}
      </label>
      <input
        id={inputId}
        name="name"
        className={styles.input}
        defaultValue={passkey.name}
        maxLength={60}
        required
      />
      <button type="submit" className={styles.secondary} disabled={pending}>
        Rename
      </button>
      <SaveStatus pending={pending} saved={state.saved} error={state.error} />
    </form>
  );
}
