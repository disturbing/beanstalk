/**
 * Where repositories live in the app (`/<owner>/<repo>`), the names the app's own routes
 * take (an owner or repository can never be one of them), and how a person or an agent
 * starts: the clone URL, a first bean pushed with plain git, and the three ways to connect
 * git (the Plugin, HTTPS and Env vars tabs of the start page).
 */
import { isReservedHandle } from '@beanstalk/shared-identity/reserved-handles';

/** Top-level static files and scripts the app serves, beside the routes accounts reserve. */
const STATIC_PATHS: ReadonlySet<string> = new Set([
  '_next',
  'assets',
  'favicon.ico',
  'setup.sh',
  'setup.ps1',
]);

/** Sub-paths of a repository the app serves. */
export const REPOSITORY_VIEWS = ['files', 'settings'] as const;

export function repositoryPath(owner: string, name: string): string {
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

/**
 * Whether `owner` is a path the app serves itself: a reserved handle (accounts refuse them at
 * sign-up; `reserved-routes.test.ts` checks every top-level route is one) or a static file.
 */
export function isReservedOwner(owner: string): boolean {
  return isReservedHandle(owner) || STATIC_PATHS.has(owner.toLowerCase());
}

/** The deployment's public addresses for git, MCP and the web app (vars, per environment). */
export type StartConfig = {
  /** The gateway's public origin, e.g. `https://git.beanstalk.example`. */
  readonly gitOrigin: string;
  /** The MCP endpoint agents connect to. */
  readonly mcpUrl: string;
  /** The web app's origin (where `setup.sh` and Settings live). */
  readonly webOrigin: string;
  /** Git over SSH, once the deployment has an SSH endpoint (`SSH_HOST`). */
  readonly ssh?: SshEndpoint;
};

/** The SSH endpoint: its host and the host key's fingerprint people check on first connect. */
export type SshEndpoint = { readonly host: string; readonly hostKeyFingerprint: string };

/** The SSH endpoint the vars describe, or undefined when `SSH_HOST` is empty. */
export function sshEndpoint(vars: {
  readonly SSH_HOST: string;
  readonly SSH_HOST_KEY_FINGERPRINT: string;
}): SshEndpoint | undefined {
  const host = vars.SSH_HOST.trim();
  if (host === '') return undefined;
  return { host, hostKeyFingerprint: vars.SSH_HOST_KEY_FINGERPRINT.trim() };
}

/** `ssh://git@<host>/<owner>/<repo>.git`. */
export function sshCloneUrl(endpoint: SshEndpoint, owner: string, name: string): string {
  return `ssh://git@${endpoint.host}/${owner}/${name}.git`;
}

export type StartGuide = {
  readonly cloneUrl: string;
  /** Shell lines for a first bean pushed with plain git. */
  readonly gitSteps: readonly string[];
  /** One install line per harness. */
  readonly agents: readonly { readonly harness: string; readonly line: string }[];
  /** What to say to a connected agent. */
  readonly prompt: string;
  /** The Plugin tab: one line that installs the plugin and runs setup; Codex's equivalent. */
  readonly plugin: {
    readonly claude: string;
    readonly codex: string;
    readonly codexPrompt: string;
  };
  /** The HTTPS tab: where a token comes from, and the token-in-URL last resort. */
  readonly https: { readonly tokensPath: string; readonly urlWithToken: string };
  /** The gateway origin the Env vars tab configures. */
  readonly gitOrigin: string;
  /** The SSH clone URL and the host key fingerprint, when the deployment serves SSH. */
  readonly ssh: { readonly cloneUrl: string; readonly hostKeyFingerprint: string } | null;
};

/**
 * The public repository whose `.claude-plugin/marketplace.json` lists the plugin (its default
 * branch, `prototype`, holds the code; `owner/repo#branch` names another branch).
 */
const PLUGIN_MARKETPLACE = 'disturbing/beanstalk';

export function startGuide(config: StartConfig, owner: string, name: string): StartGuide {
  const origin = config.gitOrigin.replace(/\/+$/, '');
  const web = config.webOrigin.replace(/\/+$/, '');
  const cloneUrl = `${origin}/git/${owner}/${name}.git`;
  const directory = name.replace(/\.+$/, '') || 'repo';
  return {
    cloneUrl,
    gitSteps: [
      `git clone ${cloneUrl}`,
      `cd ${directory}`,
      'git switch -c bean/first-change',
      '# edit something, then',
      'git commit -am "Say what the change does"',
      'git push -o wait origin bean/first-change',
    ],
    agents: [
      {
        harness: 'Claude Code',
        line: `claude plugin marketplace add ${PLUGIN_MARKETPLACE} && claude plugin install beanstalk@beanstalk`,
      },
      {
        harness: 'Codex',
        line: `codex mcp add beanstalk --url ${config.mcpUrl} && codex mcp login beanstalk`,
      },
      { harness: 'Any MCP client', line: config.mcpUrl },
    ],
    prompt: `Work on ${owner}/${name} on Beanstalk: clone it, make the change as a bean, and push it.`,
    plugin: {
      claude: `claude plugin marketplace add ${PLUGIN_MARKETPLACE} && claude plugin install beanstalk@beanstalk && claude "/beanstalk:setup ${owner}/${name}"`,
      codex: `codex mcp add beanstalk --url ${config.mcpUrl} && codex mcp login beanstalk`,
      codexPrompt: `Set up git for Beanstalk: run "curl -fsSL ${web}/setup.sh | sh -s -- detect", ask me which SSH key to use, register it with the same script, then run its "remote ${owner}/${name}".`,
    },
    https: {
      tokensPath: '/settings/tokens',
      urlWithToken: cloneUrl.replace(/^https:\/\//, 'https://x:<token>@'),
    },
    gitOrigin: origin,
    ssh:
      config.ssh === undefined
        ? null
        : {
            cloneUrl: sshCloneUrl(config.ssh, owner, name),
            hostKeyFingerprint: config.ssh.hostKeyFingerprint,
          },
  };
}

/**
 * The Env vars tab's block for CI and scripts: git reads the token from BEANSTALK_TOKEN for
 * the Beanstalk host only, through `GIT_CONFIG_*` (git 2.31+), and never prompts. The second
 * form sends it as a Bearer header instead of through a credential helper.
 */
export function envVarsBlock(
  gitOrigin: string,
  token: string | null,
): { readonly helper: string; readonly header: string } {
  const origin = gitOrigin.replace(/\/+$/, '');
  const common = [
    `export BEANSTALK_TOKEN=${token ?? '<deploy token>'}`,
    'export GIT_TERMINAL_PROMPT=0',
    'export GIT_CONFIG_COUNT=1',
  ];
  return {
    helper: [
      ...common,
      `export GIT_CONFIG_KEY_0='credential.${origin}.helper'`,
      `export GIT_CONFIG_VALUE_0='!f() { echo "username=x"; echo "password=$BEANSTALK_TOKEN"; }; f'`,
    ].join('\n'),
    header: [
      ...common,
      `export GIT_CONFIG_KEY_0='http.${origin}/.extraheader'`,
      'export GIT_CONFIG_VALUE_0="Authorization: Bearer $BEANSTALK_TOKEN"',
    ].join('\n'),
  };
}
