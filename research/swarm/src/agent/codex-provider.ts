import type { Credential } from '../match/match-schema';

/** The virtual host the agent container reaches the model through (plain HTTP to the handler). */
export const MODEL_HOST = 'model.internal';

/** What the slot driver needs to point Codex at `model.internal`; never a credential. */
export type CodexSetup = {
  /** `-c key=value` overrides appended to the harness's `codex exec` argv. */
  readonly config_overrides: readonly string[];
  /** Lease mode: write a placeholder ChatGPT `auth.json` (made-up tokens) into `CODEX_HOME`. */
  readonly placeholder_auth: boolean;
};

/**
 * Codex's model provider for a credential mode. Verified with codex-cli 0.160.1 against a local
 * stub (2026-10-07): a custom provider's plain-HTTP `base_url` is accepted; Codex streams
 * `POST <base_url>/responses` with `Authorization: Bearer <env_key value>` (api-key), or, with
 * `requires_openai_auth = true` and ChatGPT auth, with the auth.json access token and a
 * `chatgpt-account-id` header, plus `GET <base_url>/models` (lease).
 */
export function codexSetup(credential: Credential): CodexSetup {
  switch (credential.mode) {
    case 'none':
      return { config_overrides: [], placeholder_auth: false };
    case 'api-key':
      return {
        config_overrides: [
          'model_provider="swarm"',
          `model_providers.swarm={name="swarm",base_url="http://${MODEL_HOST}/v1",env_key="SWARM_MODEL_KEY",wire_api="responses"}`,
        ],
        placeholder_auth: false,
      };
    case 'lease':
      return {
        config_overrides: [
          'model_provider="swarm"',
          `model_providers.swarm={name="swarm",base_url="http://${MODEL_HOST}/backend-api/codex",requires_openai_auth=true,wire_api="responses"}`,
        ],
        placeholder_auth: true,
      };
  }
}
