import { SecretsSettings } from '../../../../../components/actions/secrets-settings';
import { VariablesSettings } from '../../../../../components/actions/variables-settings';
import { RepositorySettingsFrame } from '../../../../../components/repository/repository-settings-frame';
import { SettingsSection } from '../../../../../components/settings/settings-shell';
import type {
  RepoEntries,
  SecretList,
  SecretSummary,
} from '../../../../../src/actions/actions-contract';
import type { RepositoryParams } from '../../../../../src/server/repository-page';
import {
  repositorySettings,
  settingsMetadata,
} from '../../../../../src/server/repository-settings';

/** Per person and per request: never prerendered or cached. */
export const dynamic = 'force-dynamic';
export const generateMetadata = settingsMetadata('Secrets and variables');

/**
 * Settings → Secrets and variables (everyone with a role, where Actions run): the repository's
 * Actions secrets by name and its variables, with the org's that reach it. Maintainers and the
 * owner add, change and delete them; each form saves on its own.
 */
export default async function SecretsSettingsPage(props: { readonly params: RepositoryParams }) {
  const settings = await repositorySettings(props.params, 'secrets');
  const { actions, maintains, isArchived, session, record } = settings;
  const [secrets, entries] =
    actions === null
      ? [null, null]
      : await Promise.all([maintains ? actions.client.secrets() : null, actions.client.entries()]);
  const access =
    maintains && !isArchived
      ? { csrf: session.csrfToken, owner: record.owner.handle, name: record.name }
      : null;
  const nowMs = Date.now();
  return (
    <RepositorySettingsFrame
      settings={settings}
      current="secrets"
      title="Secrets and variables"
      lede="What workflows and automations read as secrets.NAME and vars.NAME."
    >
      <SettingsSection id="actions" title="Actions">
        <SecretsSettings
          secrets={ownSecrets(secrets, entries)}
          inherited={inheritedOf(entries).secrets}
          error={entriesError(secrets, entries)}
          usage={secrets?.ok === true ? secrets.value.usage : null}
          canToggle={actions?.client.canToggleSecretWithoutValue ?? false}
          access={access}
          nowMs={nowMs}
        />
        <VariablesSettings
          own={entries?.ok === true ? entries.value.variables.filter(isOwn) : []}
          inherited={inheritedOf(entries).variables}
          access={access}
          nowMs={nowMs}
        />
      </SettingsSection>
    </RepositorySettingsFrame>
  );
}

type Listed<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly message: string } };

/** The repository's own secrets: the full list for maintainers, names from the entries otherwise. */
function ownSecrets(
  secrets: Listed<SecretList> | null,
  entries: Listed<RepoEntries> | null,
): readonly SecretSummary[] | null {
  if (secrets?.ok === true) return secrets.value.secrets;
  if (entries?.ok === true) return entries.value.secrets.filter(isOwn);
  return null;
}

function inheritedOf(entries: Listed<RepoEntries> | null): {
  readonly secrets: RepoEntries['secrets'];
  readonly variables: RepoEntries['variables'];
} {
  if (entries?.ok !== true) return { secrets: [], variables: [] };
  return {
    secrets: entries.value.secrets.filter((entry) => !isOwn(entry)),
    variables: entries.value.variables.filter((entry) => !isOwn(entry)),
  };
}

function entriesError(
  secrets: Listed<SecretList> | null,
  entries: Listed<RepoEntries> | null,
): string | null {
  if (secrets !== null && !secrets.ok) return secrets.error.message;
  if (entries !== null && !entries.ok) return entries.error.message;
  return null;
}

function isOwn(entry: { readonly source: { readonly kind: string } }): boolean {
  return entry.source.kind === 'repository';
}
