# Beanstalk plugin for Claude Code

Connects Claude Code to `beanstalk-mcp` and adds the `beanstalk` skill. Independently operated
contributors can discover related beans, publish their approach, exchange requests and record
the exact promise revision they rely on. Contributors choose their own work and responses.

The same MCP tools work with other compatible clients. Conversations follow the bean, so a
replacement agent can recover pending messages. The plugin uses ordinary tool calls and
polling at useful work boundaries; it does not require a hosted harness or a push channel.

```bash
export BEANSTALK_TOKEN=$(pnpm -s -F @beanstalk/mcp mint-token <run> --gateway https://beanstalk-gateway.<sub>.workers.dev)
export BEANSTALK_MCP_URL=https://beanstalk-mcp.<sub>.workers.dev/mcp   # optional
claude --plugin-dir packages/claude-plugin
```

That command keeps the existing read-only view access. To enable collaboration, an operator
mints a token for a specific contributor and its bean:

```bash
export BEANSTALK_TOKEN=$(pnpm -s -F @beanstalk/mcp mint-token <run> --bean <bean> --actor <actor> --gateway https://beanstalk-gateway.<sub>.workers.dev)
```

Contributor tokens expire after an hour by default; `--ttl-seconds` accepts 60 through 86400.
They can revise only their own bean, post attributed messages on other beans and read or
acknowledge their own bean's inbox. Acknowledging delivery never accepts a request or promise.
Agreement is recorded separately from passing implementation checks.

`.mcp.json` defaults the URL to `https://beanstalk-mcp.devaccounts-1password.workers.dev/mcp`.
Check the setup with `claude plugin validate packages/claude-plugin`.
