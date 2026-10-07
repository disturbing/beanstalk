/**
 * The commands `/signup/agent` prints, per harness (`docs/claude-opus/16` item 1.4). The plugin
 * comes from the public marketplace repository, whose `.mcp.json` names the hosted MCP server
 * with no auth header, so each client runs its own OAuth sign-in. A deployment serving
 * another MCP address (staging, a fork) gets plain `mcp add` lines for its own address instead,
 * because the plugin would connect to the hosted one.
 */

/**
 * The public repository whose `.claude-plugin/marketplace.json` lists the plugin (its default
 * branch, `prototype`, holds the code; `owner/repo#branch` names another branch). The start
 * page's lines (`repositories/paths.ts`) use it too.
 */
export const PLUGIN_MARKETPLACE = 'disturbing/beanstalk';

/** The MCP address in `packages/claude-plugin/.mcp.json` (a test keeps the two equal). */
export const PLUGIN_MCP_URL = 'https://beanstalk-mcp.devaccounts-1password.workers.dev/mcp';

export type AgentInstall = {
  readonly id: 'claude-code' | 'codex' | 'cursor' | 'gemini' | 'mcp';
  readonly name: string;
  /** Where the text goes. */
  readonly where: string;
  readonly code: string;
  /** What happens next, in a sentence or two. */
  readonly after: string;
  /** Whether this exact text was run end to end against Beanstalk. */
  readonly verified: boolean;
};

export function agentInstalls(mcpUrl: string): readonly AgentInstall[] {
  const hosted = mcpUrl === PLUGIN_MCP_URL;
  return [
    {
      id: 'claude-code',
      name: 'Claude Code',
      where: 'paste in your terminal',
      code: hosted
        ? `claude plugin marketplace add ${PLUGIN_MARKETPLACE} && claude plugin install beanstalk@beanstalk && claude mcp login plugin:beanstalk:beanstalk`
        : `claude mcp add --transport http beanstalk ${mcpUrl} && claude mcp login beanstalk`,
      after:
        'Your browser opens once: sign in (or create your account) and approve the session. Back in Claude Code the Beanstalk tools are ready. Already in a session? Type /mcp and pick beanstalk.',
      verified: true,
    },
    {
      id: 'codex',
      name: 'Codex',
      where: 'paste in your terminal',
      code: hosted
        ? `codex plugin marketplace add ${PLUGIN_MARKETPLACE} && codex plugin add beanstalk@beanstalk && codex mcp login beanstalk`
        : `codex mcp add beanstalk --url ${mcpUrl} && codex mcp login beanstalk`,
      after:
        'The last step opens your browser: sign in and approve the session. Codex keeps running on your own plan; the session acts as you.',
      verified: true,
    },
    {
      id: 'cursor',
      name: 'Cursor',
      where: 'add to ~/.cursor/mcp.json, then run in your terminal',
      code: `{ "mcpServers": { "beanstalk": { "url": "${mcpUrl}" } } }\ncursor-agent mcp login beanstalk`,
      after: 'Or open Cursor Settings › MCP and click “Needs login” next to beanstalk.',
      verified: false,
    },
    {
      id: 'gemini',
      name: 'Gemini CLI',
      where: 'paste in your terminal, then in Gemini',
      code: `gemini mcp add --transport http beanstalk ${mcpUrl}\n/mcp auth beanstalk`,
      after: 'The second line runs inside Gemini CLI and opens the browser sign-in.',
      verified: false,
    },
    {
      id: 'mcp',
      name: 'Other MCP client',
      where: 'add as a remote (HTTP) MCP server',
      code: mcpUrl,
      after:
        'The client’s first call opens the same browser sign-in; approve it and it is connected.',
      verified: false,
    },
  ];
}
