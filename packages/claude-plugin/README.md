# Beanstalk plugin for Claude Code

Connects Claude Code to `beanstalk-mcp` (read-only tools over one run) and adds the
`beanstalk` skill: check `work_overlaps` before editing, poll `change_status` after submitting,
read `checks_get` on a red check and fix code (never protected tests), orient with `ask_repo`.

```bash
export BEANSTALK_TOKEN=$(pnpm -s -F @beanstalk/mcp mint-token <run> --gateway https://beanstalk-gateway.<sub>.workers.dev)
export BEANSTALK_MCP_URL=https://beanstalk-mcp.<sub>.workers.dev/mcp   # optional
claude --plugin-dir packages/claude-plugin
```

`.mcp.json` defaults the URL to `https://beanstalk-mcp.devaccounts-1password.workers.dev/mcp`.
Check the setup with `claude plugin validate packages/claude-plugin`.
