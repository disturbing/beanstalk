/**
 * Where repositories live in the app (`/<owner>/<repo>`), the names the app's own routes
 * take (an owner or repository can never be one of them), and how a person or an agent
 * starts: the clone URL, a first bean pushed with plain git, and the agent install lines.
 */

/** Top-level paths the app serves itself; handles must avoid them (accounts enforce it). */
export const RESERVED_OWNERS: ReadonlySet<string> = new Set([
  'api',
  'assets',
  'auth',
  'login',
  'logout',
  'new',
  'race',
  'races',
  'runs',
  'settings',
  'signup',
  'connect',
  'inbox',
  'favicon.ico',
]);

/** Sub-paths of a repository the app serves. */
export const REPOSITORY_VIEWS = ['files', 'settings'] as const;

export function repositoryPath(owner: string, name: string): string {
  return `/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

export function isReservedOwner(owner: string): boolean {
  return RESERVED_OWNERS.has(owner.toLowerCase());
}

/** The deployment's public addresses for git and MCP (vars, so each environment sets its own). */
export type StartConfig = {
  /** The gateway's public origin, e.g. `https://git.beanstalk.example`. */
  readonly gitOrigin: string;
  /** The MCP endpoint agents connect to. */
  readonly mcpUrl: string;
};

export type StartGuide = {
  readonly cloneUrl: string;
  /** Shell lines for a first bean pushed with plain git. */
  readonly gitSteps: readonly string[];
  /** One install line per harness. */
  readonly agents: readonly { readonly harness: string; readonly line: string }[];
  /** What to say to a connected agent. */
  readonly prompt: string;
};

const PLUGIN_REPO = 'beanstalkdev/beanstalk-plugin';

export function startGuide(config: StartConfig, owner: string, name: string): StartGuide {
  const cloneUrl = `${config.gitOrigin.replace(/\/+$/, '')}/git/${owner}/${name}.git`;
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
        line: `claude plugin marketplace add ${PLUGIN_REPO} && claude plugin install beanstalk@beanstalk`,
      },
      { harness: 'Codex', line: `codex mcp add beanstalk --url ${config.mcpUrl}` },
      { harness: 'Any MCP client', line: config.mcpUrl },
    ],
    prompt: `Work on ${owner}/${name} on Beanstalk: clone it, make the change as a bean, and push it.`,
  };
}
