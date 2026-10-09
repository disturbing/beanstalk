/**
 * A settings section for one uploaded picture (an org's icon, a repository's social image):
 * the current one, the last upload's note, a multipart upload form and a remove button. The
 * route handler at `action` validates, stores in R2 and redirects back with `?picture=`.
 */
import type { ReactNode } from 'react';

import type { PictureNote } from '../../src/account/picture-notes';
import repo from '../repository/repository.module.css';
import { SettingsSection } from './settings-shell';

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';

export function PictureSection(props: {
  readonly id: string;
  readonly title: string;
  readonly lede: string;
  /** The route handler that takes `file` (upload) or `remove=1`. */
  readonly action: string;
  readonly csrf: string;
  readonly current: ReactNode;
  readonly hasPicture: boolean;
  readonly note: PictureNote | null;
  readonly removeLabel: string;
}) {
  const inputId = `${props.id}-file`;
  return (
    <SettingsSection id={props.id} title={props.title} lede={props.lede}>
      {props.current}
      {props.note === null ? null : (
        <p
          className={props.note.kind === 'error' ? repo.error : repo.saved}
          role={props.note.kind === 'error' ? 'alert' : 'status'}
        >
          {props.note.text}
        </p>
      )}
      <form
        method="post"
        action={props.action}
        encType="multipart/form-data"
        className={repo.actions}
      >
        <input type="hidden" name="csrf" value={props.csrf} />
        <label htmlFor={inputId} className="visually-hidden">
          {props.title} file
        </label>
        <input
          id={inputId}
          type="file"
          name="file"
          accept={ACCEPT}
          required
          className={repo.fileInput}
        />
        <button type="submit" className={repo.secondary}>
          Upload
        </button>
      </form>
      {props.hasPicture ? (
        <form method="post" action={props.action}>
          <input type="hidden" name="csrf" value={props.csrf} />
          <input type="hidden" name="remove" value="1" />
          <button type="submit" className={repo.danger}>
            {props.removeLabel}
          </button>
        </form>
      ) : null}
    </SettingsSection>
  );
}
