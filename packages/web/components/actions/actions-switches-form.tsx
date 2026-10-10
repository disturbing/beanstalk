'use client';

/**
 * Settings → Actions: the dependency cache, its snapshot cap and npm's install-time audit, in
 * one form with one Save. Each is a repository variable (`src/actions/actions-switches.ts`);
 * an org variable of the same name applies when the repository sets none.
 */
import type { ActionsSwitches } from '../../src/actions/actions-switches';
import type { ActionsAccess } from '../../src/server/actions-page';
import type { WorkflowFormState } from '../../src/server/workflow-actions';
import { saveActionsSwitchesAction } from '../../src/server/workflow-actions';
import repo from '../repository/repository.module.css';
import { useSavedForm } from '../settings/use-saved-form';
import { AccessFields } from './access-fields';

export function ActionsSwitchesForm(props: {
  readonly switches: ActionsSwitches;
  /** Null for people who may only read (or an archived repository). */
  readonly access: ActionsAccess | null;
}) {
  const { state, action, pending, saved, savedChecked } = useSavedForm<WorkflowFormState>(
    saveActionsSwitchesAction,
    { kind: 'idle' },
  );
  const isReadOnly = props.access === null;
  const { switches } = props;
  return (
    <form
      action={action}
      className={`${repo.panel} ${repo.settingsSection}`}
      aria-labelledby="actions-switches-title"
    >
      <h2 id="actions-switches-title">Jobs</h2>
      {props.access === null ? null : <AccessFields access={props.access} />}
      <fieldset className={repo.choices} disabled={isReadOnly}>
        <legend>Dependency cache</legend>
        <label className={repo.choice}>
          <input
            type="checkbox"
            name="depsCache"
            value="on"
            defaultChecked={savedChecked('depsCache', switches.depsCache === 'on')}
          />
          <span>
            <b>Cache node_modules between jobs</b>
            <span>
              Jobs that use <code>actions/setup-node</code> with <code>cache:</code>,{' '}
              <code>actions/cache</code> on <code>node_modules</code>, or{' '}
              <code>gitstalk/deps-cache@v1</code> restore their dependencies from Gitstalk’s cache.
              Off sets <code>GITSTALK_DEPS_CACHE=off</code>.
            </span>
          </span>
        </label>
        <div className={repo.field}>
          <label htmlFor="actions-snapshot-max" className={repo.label}>
            Largest snapshot
          </label>
          <input
            id="actions-snapshot-max"
            name="snapshotMax"
            className={repo.input}
            defaultValue={saved('snapshotMax', switches.snapshotMax)}
            placeholder="4GiB (the default)"
            maxLength={20}
            spellCheck={false}
            aria-describedby="actions-snapshot-max-hint"
          />
          <span id="actions-snapshot-max-hint" className={repo.hint}>
            A dependency tree larger than this is not cached. Empty keeps the deployment’s default;
            sizes such as <code>2GiB</code> or <code>500MB</code> (
            <code>GITSTALK_DEPS_SNAPSHOT_MAX</code>).
          </span>
        </div>
      </fieldset>
      <fieldset className={repo.choices} disabled={isReadOnly}>
        <legend>npm</legend>
        <label className={repo.choice}>
          <input
            type="checkbox"
            name="npmAudit"
            value="on"
            defaultChecked={savedChecked('npmAudit', switches.npmAudit === 'on')}
          />
          <span>
            <b>Run npm’s audit during installs</b>
            <span>
              Off by default: it adds about 90 seconds of CPU to a large <code>npm ci</code> and
              never changes what is installed. An explicit <code>npm audit</code> step always
              audits. On sets <code>GITSTALK_NPM_AUDIT=on</code>.
            </span>
          </span>
        </label>
      </fieldset>
      {state.kind === 'idle' ? null : (
        <p
          className={state.kind === 'refused' ? repo.error : repo.saved}
          role={state.kind === 'refused' ? 'alert' : 'status'}
        >
          {state.message}
        </p>
      )}
      {isReadOnly ? (
        <p className={repo.hint}>Maintainers and the owner change these.</p>
      ) : (
        <div className={repo.actions}>
          <button type="submit" className={repo.primary} disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </form>
  );
}
