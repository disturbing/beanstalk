import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { PLUGIN_MCP_URL, agentInstalls } from './agent-installs';

const PluginMcp = z.object({
  mcpServers: z.object({
    beanstalk: z.object({ type: z.literal('http'), url: z.string() }).strict(),
  }),
});

function pluginMcpJson(): z.infer<typeof PluginMcp> {
  const path = fileURLToPath(new URL('../../../claude-plugin/.mcp.json', import.meta.url));
  return PluginMcp.parse(JSON.parse(readFileSync(path, 'utf8')));
}

describe("the plugin's MCP server", () => {
  it('is the hosted address, literally, with no auth header so clients use OAuth', () => {
    const server = pluginMcpJson().mcpServers.beanstalk;
    // Codex does not expand ${VAR:-default} in a plugin's URL; a literal works in both.
    expect(server.url).toBe(PLUGIN_MCP_URL);
    expect(server.url).not.toContain('$');
  });
});

describe('the commands /signup/agent prints', () => {
  it('installs the plugin and signs in, for the hosted deployment', () => {
    const [claude, codex] = agentInstalls(PLUGIN_MCP_URL);
    expect(claude?.code).toBe(
      'claude plugin marketplace add disturbing/beanstalk && claude plugin install beanstalk@beanstalk && claude mcp login plugin:beanstalk:beanstalk',
    );
    expect(codex?.code).toBe(
      'codex plugin marketplace add disturbing/beanstalk && codex plugin add beanstalk@beanstalk && codex mcp login beanstalk',
    );
  });

  it('adds this deployment’s own MCP address anywhere else', () => {
    const staging = 'https://beanstalk-mcp-staging.example.workers.dev/mcp';
    const installs = agentInstalls(staging);
    expect(installs[0]?.code).toBe(
      `claude mcp add --transport http beanstalk ${staging} && claude mcp login beanstalk`,
    );
    expect(installs[1]?.code).toBe(
      `codex mcp add beanstalk --url ${staging} && codex mcp login beanstalk`,
    );
    expect(installs.every((install) => !install.code.includes(PLUGIN_MCP_URL))).toBe(true);
  });
});
