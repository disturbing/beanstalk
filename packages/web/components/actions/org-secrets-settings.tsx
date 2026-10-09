'use client';

/**
 * Org Settings → Secrets and variables. Secrets are listed by name with the repositories they
 * reach and their pre-land switch; a value is typed once and never shown again. Variables are
 * listed with their values. Each entry reaches all repositories, the private ones, or the ones
 * picked from the org's list; a repository's own entry of the same name wins over it.
 * Owners and admins manage (the gateway checks again); members only read.
 */
import { useActionState, useState } from 'react';

import type {
  AccessPolicy,
  OrgRepository,
  OrgSecret,
  OrgSettings,
  OrgVariable,
} from '../../src/actions/actions-contract';
import { timeAgo } from '../../src/repositories/when';
import {
  deleteOrgSecretAction,
  deleteOrgVariableAction,
  putOrgSecretAction,
  putOrgVariableAction,
} from '../../src/server/org-secrets-actions';
import type { WorkflowFormState } from '../../src/server/workflow-actions';
import repoStyles from '../repository/repository.module.css';
import styles from './actions.module.css';
import { FormMessage, PrelandRisk } from './secrets-settings';

/** What an owner's or admin's forms send. */
export type OrgFormAccess = { readonly csrf: string; readonly org: string };

type FormAction = (state: WorkflowFormState, form: FormData) => Promise<WorkflowFormState>;

export function OrgSecretsSettings(props: {
  readonly settings: OrgSettings;
  readonly access: OrgFormAccess | null;
  readonly nowMs: number;
}) {
  const { settings, access, nowMs } = props;
  const repos = settings.repositories;
  return (
    <>
      <section
        className={`${repoStyles.panel} ${repoStyles.settingsSection}`}
        aria-labelledby="org-secrets-title"
      >
        <h2 id="org-secrets-title">Secrets</h2>
        <p>
          Workflows in the repositories a secret reaches read it as{' '}
          <code>{'${{ secrets.NAME }}'}</code>. A value is never shown again after you save it, is
          masked as <code>***</code> in logs, and never reaches agent sessions. A repository secret
          of the same name wins over the org&rsquo;s.
          {access === null ? ' Owners and admins manage them; you can see the names.' : null}
        </p>
        {access === null ? null : <AddOrgSecret access={access} repos={repos} />}
        <EntryList
          empty="No org secrets yet."
          label="Org secrets"
          entries={settings.secrets.map((secret) => ({
            key: secret.name,
            row: <SecretRow secret={secret} access={access} repos={repos} nowMs={nowMs} />,
          }))}
        />
      </section>
      <section
        className={`${repoStyles.panel} ${repoStyles.settingsSection}`}
        aria-labelledby="org-variables-title"
      >
        <h2 id="org-variables-title">Variables</h2>
        <p>
          Plain configuration, read as <code>{'${{ vars.NAME }}'}</code>. Org members and anyone
          with a role on a repository it reaches see the value; logs print it as it is.
        </p>
        {access === null ? null : <AddOrgVariable access={access} repos={repos} />}
        <EntryList
          empty="No org variables yet."
          label="Org variables"
          entries={settings.variables.map((variable) => ({
            key: variable.name,
            row: <VariableRow variable={variable} access={access} repos={repos} nowMs={nowMs} />,
          }))}
        />
      </section>
      {access === null ? null : (
        <section
          className={`${repoStyles.panel} ${repoStyles.settingsSection}`}
          aria-labelledby="org-audit-title"
        >
          <h2 id="org-audit-title">Changes</h2>
          {settings.audit.length === 0 ? (
            <p className={styles.muted}>No changes yet.</p>
          ) : (
            <ul className={styles.auditList}>
              {settings.audit.map((line) => (
                <li key={`${line.at}-${line.action}-${line.detail}`}>
                  @{line.actorHandle} {AUDIT_WORDS[line.action] ?? line.action} <b>{line.detail}</b>{' '}
                  · {timeAgo(line.at, nowMs)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

const AUDIT_WORDS: Readonly<Record<string, string>> = {
  'org-secret-set': 'saved the secret',
  'org-secret-deleted': 'deleted the secret',
  'org-variable-set': 'saved the variable',
  'org-variable-deleted': 'deleted the variable',
};

function EntryList(props: {
  readonly empty: string;
  readonly label: string;
  readonly entries: readonly { readonly key: string; readonly row: React.ReactNode }[];
}) {
  if (props.entries.length === 0) return <p className={styles.muted}>{props.empty}</p>;
  return (
    <ul className={styles.secrets} aria-label={props.label}>
      {props.entries.map((entry) => (
        <li key={entry.key}>{entry.row}</li>
      ))}
    </ul>
  );
}

function AddOrgSecret(props: {
  readonly access: OrgFormAccess;
  readonly repos: readonly OrgRepository[];
}) {
  const [state, action, pending] = useActionState<WorkflowFormState, FormData>(putOrgSecretAction, {
    kind: 'idle',
  });
  const [preland, setPreland] = useState(false);
  return (
    <form action={action} className={styles.secretForm} autoComplete="off">
      <OrgFields access={props.access} />
      <label className={styles.field}>
        <span>Name</span>
        <input
          name="secret"
          className={styles.input}
          placeholder="CLOUDFLARE_API_TOKEN"
          required
          maxLength={100}
          spellCheck={false}
          autoCapitalize="characters"
        />
      </label>
      <label className={styles.field}>
        <span>Value</span>
        <input
          name="value"
          type="password"
          className={styles.input}
          required
          autoComplete="new-password"
          spellCheck={false}
        />
        <small>Saving a name that exists replaces its value.</small>
      </label>
      <PolicyPicker repos={props.repos} initial={{ kind: 'all' }} idPrefix="new-secret" />
      <label className={styles.check}>
        <input
          type="checkbox"
          name="preland"
          checked={preland}
          onChange={(event) => setPreland(event.target.checked)}
        />
        <span>Available to pre-land checks</span>
      </label>
      {preland ? <PrelandRisk /> : null}
      <div className={styles.formFoot}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Saving…' : 'Save secret'}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function AddOrgVariable(props: {
  readonly access: OrgFormAccess;
  readonly repos: readonly OrgRepository[];
}) {
  const [state, action, pending] = useActionState<WorkflowFormState, FormData>(
    putOrgVariableAction,
    { kind: 'idle' },
  );
  return (
    <form action={action} className={styles.secretForm} autoComplete="off">
      <OrgFields access={props.access} />
      <label className={styles.field}>
        <span>Name</span>
        <input
          name="variable"
          className={styles.input}
          placeholder="CLOUDFLARE_ACCOUNT_ID"
          required
          maxLength={100}
          spellCheck={false}
          autoCapitalize="characters"
        />
      </label>
      <label className={styles.field}>
        <span>Value</span>
        <input name="value" className={styles.input} spellCheck={false} />
      </label>
      <PolicyPicker repos={props.repos} initial={{ kind: 'all' }} idPrefix="new-variable" />
      <div className={styles.formFoot}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Saving…' : 'Save variable'}
        </button>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function SecretRow(props: {
  readonly secret: OrgSecret;
  readonly access: OrgFormAccess | null;
  readonly repos: readonly OrgRepository[];
  readonly nowMs: number;
}) {
  const { secret, access } = props;
  const [editing, setEditing] = useState(false);
  return (
    <>
      <div>
        <span className={styles.secretName}>{secret.name}</span>
        <br />
        <span className={styles.policyLine}>{policyText(secret.access, props.repos)}</span>
        <br />
        <span className={styles.secretMeta}>
          Updated {timeAgo(secret.updatedAt, props.nowMs)} by @{secret.updatedBy}
          {secret.prelandAllowed ? ' · available to pre-land checks' : ''}
        </span>
        {access !== null && editing ? (
          <EditSecretAccess secret={secret} access={access} repos={props.repos} />
        ) : null}
      </div>
      {access === null ? null : (
        <div className={styles.secretTools}>
          <button
            type="button"
            className={styles.iconButton}
            aria-expanded={editing}
            onClick={() => setEditing(!editing)}
          >
            {editing ? 'Close' : 'Edit access'}
          </button>
          <DeleteEntry
            action={deleteOrgSecretAction}
            access={access}
            field="secret"
            name={secret.name}
          />
        </div>
      )}
    </>
  );
}

function EditSecretAccess(props: {
  readonly secret: OrgSecret;
  readonly access: OrgFormAccess;
  readonly repos: readonly OrgRepository[];
}) {
  const [state, action, pending] = useActionState<WorkflowFormState, FormData>(putOrgSecretAction, {
    kind: 'idle',
  });
  const [preland, setPreland] = useState(props.secret.prelandAllowed);
  return (
    <form action={action} className={styles.secretForm}>
      <OrgFields access={props.access} />
      <input type="hidden" name="secret" value={props.secret.name} />
      <input type="hidden" name="mode" value="keep" />
      <PolicyPicker
        repos={props.repos}
        initial={props.secret.access}
        idPrefix={`secret-${props.secret.name}`}
      />
      <label className={styles.check}>
        <input
          type="checkbox"
          name="preland"
          checked={preland}
          onChange={(event) => setPreland(event.target.checked)}
        />
        <span>Available to pre-land checks</span>
      </label>
      {preland ? <PrelandRisk /> : null}
      <div className={styles.formFoot}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? 'Saving…' : 'Save access'}
        </button>
        <span className={styles.secretMeta}>The value stays as it is.</span>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function VariableRow(props: {
  readonly variable: OrgVariable;
  readonly access: OrgFormAccess | null;
  readonly repos: readonly OrgRepository[];
  readonly nowMs: number;
}) {
  const { variable, access } = props;
  return (
    <>
      <div>
        <span className={styles.secretName}>{variable.name}</span>{' '}
        <code className={styles.variableValue}>{variable.value}</code>
        <br />
        <span className={styles.policyLine}>{policyText(variable.access, props.repos)}</span>
        <br />
        <span className={styles.secretMeta}>
          Updated {timeAgo(variable.updatedAt, props.nowMs)} by @{variable.updatedBy}
        </span>
      </div>
      {access === null ? null : (
        <div className={styles.secretTools}>
          <DeleteEntry
            action={deleteOrgVariableAction}
            access={access}
            field="variable"
            name={variable.name}
          />
        </div>
      )}
    </>
  );
}

function DeleteEntry(props: {
  readonly action: FormAction;
  readonly access: OrgFormAccess;
  readonly field: 'secret' | 'variable';
  readonly name: string;
}) {
  const [state, remove, deleting] = useActionState<WorkflowFormState, FormData>(props.action, {
    kind: 'idle',
  });
  if (state.kind === 'done') return <span className={styles.status}>Deleted</span>;
  return (
    <form action={remove}>
      <OrgFields access={props.access} />
      <input type="hidden" name={props.field} value={props.name} />
      <button
        type="submit"
        className={styles.danger}
        disabled={deleting}
        aria-label={`Delete ${props.name}`}
      >
        Delete
      </button>
      <FormMessage state={state} />
    </form>
  );
}

/** Repository access: all, private only, or picked from the org's repositories. */
function PolicyPicker(props: {
  readonly repos: readonly OrgRepository[];
  readonly initial: AccessPolicy;
  readonly idPrefix: string;
}) {
  const [kind, setKind] = useState(props.initial.kind);
  const picked = new Set(props.initial.kind === 'selected' ? props.initial.repoIds : []);
  const choices = [
    { kind: 'all', label: 'All repositories' },
    { kind: 'private', label: 'Private and internal repositories' },
    { kind: 'selected', label: 'Selected repositories' },
  ] as const;
  return (
    <fieldset className={styles.policy}>
      <legend>Repository access</legend>
      {choices.map((choice) => (
        <label key={choice.kind} className={styles.check}>
          <input
            type="radio"
            name="access"
            value={choice.kind}
            checked={kind === choice.kind}
            onChange={() => setKind(choice.kind)}
          />
          <span>{choice.label}</span>
        </label>
      ))}
      {kind === 'selected' ? (
        <RepoChoices repos={props.repos} picked={picked} idPrefix={props.idPrefix} />
      ) : null}
    </fieldset>
  );
}

function RepoChoices(props: {
  readonly repos: readonly OrgRepository[];
  readonly picked: ReadonlySet<string>;
  readonly idPrefix: string;
}) {
  if (props.repos.length === 0)
    return <p className={styles.muted}>The org has no repositories yet.</p>;
  return (
    <div className={styles.repoPicker} role="group" aria-label="Selected repositories">
      {props.repos.map((repo) => (
        <label key={repo.id} className={styles.check}>
          <input
            type="checkbox"
            name="repo"
            value={repo.id}
            defaultChecked={props.picked.has(repo.id)}
            id={`${props.idPrefix}-${repo.id}`}
          />
          <span>
            {repo.name}
            {repo.visibility === 'public' ? '' : ` (${repo.visibility})`}
          </span>
        </label>
      ))}
    </div>
  );
}

function OrgFields({ access }: { readonly access: OrgFormAccess }) {
  return (
    <>
      <input type="hidden" name="csrf" value={access.csrf} />
      <input type="hidden" name="org" value={access.org} />
    </>
  );
}

function policyText(policy: AccessPolicy, repos: readonly OrgRepository[]): string {
  switch (policy.kind) {
    case 'all':
      return 'All repositories';
    case 'private':
      return 'Private and internal repositories';
    case 'selected': {
      const names = policy.repoIds.map(
        (id) => repos.find((repo) => repo.id === id)?.name ?? 'a removed repository',
      );
      return names.length === 0 ? 'No repositories selected' : `Selected: ${names.join(', ')}`;
    }
    default:
      return assertNever(policy);
  }
}

function assertNever(value: never): never {
  throw new Error(`unexpected access policy ${JSON.stringify(value)}`);
}
