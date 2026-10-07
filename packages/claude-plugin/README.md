# Beanstalk plugin for Claude Code

Teaches a coding agent to work on a Beanstalk repository: git is the interface (clone, branch
`bean/<name>`, commit with the intent, `git push` submits the bean, read the `remote:` verdict,
rebase on the sprout and fix reds), and the `beanstalk` MCP server is optional context
(`work_overlaps`, `ask_repo`, `checks_get`, decision cards, bean-to-bean conversation).

## Contents

| File | What |
|---|---|
| `.claude-plugin/plugin.json` | Manifest |
| `.mcp.json` | MCP server (HTTP, no auth header so the client uses OAuth) |
| `skills/beanstalk/` | `SKILL.md` plus `references/` (push flow, MCP tools, reds/conflicts/cards) |
| `commands/bean-status.md` | `/beanstalk:bean-status [bean]` |
| `AGENTS-snippet.md` | The same guidance, compact, to paste into a repo's `AGENTS.md` (Codex, Cursor, Copilot, Gemini CLI) |

## Install

```bash
claude --plugin-dir packages/claude-plugin        # from a checkout
claude plugin validate packages/claude-plugin
```

Set `BEANSTALK_MCP_URL` to point at another deployment. The git remote needs only a credential
(token in the URL or git's credential helper).

## Status of the server side

| Feature | State |
|---|---|
| MCP read tools, collaboration tools | Live |
| Git-native intake (`bean/<name>`, push options, `remote:` verdicts, `refs/beans/<name>/status`) | **Coming**; today beans are `beans/<task>` branches pushed by a driver |
| MCP OAuth (`/mcp` login) | **Coming**; until then use a bearer token: `claude mcp add --transport http beanstalk <url> --header "Authorization: Bearer $BEANSTALK_TOKEN"` (mint with `pnpm -s -F @beanstalk/mcp mint-token <run> [--bean <bean> --actor <actor>] --gateway <url>`; contributor tokens last an hour by default, `--ttl-seconds` 60 to 86400) |
| Task claim, `bean_open`, culprit diff and decision-card tools | **Coming** |

Update the skill, snippet and this table when those land.
