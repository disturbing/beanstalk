/**
 * Where repositories live in the app (`/<owner>/<repo>`), the names the app's own routes
 * take (an owner or repository can never be one of them), and how a person or an agent
 * starts: the clone URL, a first bean pushed with plain git, and the agent install lines.
 */
import { isReservedHandle } from '@beanstalk/shared-identity/reserved-handles';

/** Top-level static files the build serves, beside the routes accounts reserve as handles. */
const STATIC_PATHS: ReadonlySet<string> = new Set(['_next', 'assets', 'favicon.ico']);

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

/**
 * The public repository whose `.claude-plugin/marketplace.json` lists the plugin (its default
 * branch, `prototype`, holds the code; `owner/repo#branch` names another branch).
 */
const PLUGIN_MARKETPLACE = 'disturbing/beanstalk';

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
        line: `claude plugin marketplace add ${PLUGIN_MARKETPLACE} && claude plugin install beanstalk@beanstalk`,
      },
      {
        harness: 'Codex',
        line: `codex mcp add beanstalk --url ${config.mcpUrl} && codex mcp login beanstalk`,
      },
      { harness: 'Any MCP client', line: config.mcpUrl },
    ],
    prompt: `Work on ${owner}/${name} on Beanstalk: clone it, make the change as a bean, and push it.`,
  };
}
