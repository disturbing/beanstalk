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
claude plugin marketplace add disturbing/beanstalk   # the repo root's .claude-plugin/marketplace.json
claude plugin install beanstalk@beanstalk
claude mcp login plugin:beanstalk:beanstalk          # or /mcp in a session: sign in and approve
```

From a checkout: `claude --plugin-dir packages/claude-plugin`; `claude plugin validate .` checks
the marketplace, `claude plugin validate packages/claude-plugin` the plugin. A branch other than
the default is named as `disturbing/beanstalk#<branch>`.

Set `BEANSTALK_MCP_URL` to point at another deployment. The git remote needs only a credential:
a personal token (Settings, Tokens) as the password, through git's credential helper.

## Status of the server side

| Feature | State |
|---|---|
| MCP read tools, collaboration tools | Live |
| Git-native intake (`bean/<name>`, push options, `remote:` verdicts, `refs/beans/<name>/status`) | Live on people's repositories (`https://<gateway>/git/<owner>/<repo>.git`) |
| MCP OAuth (`claude mcp login`, `/mcp`) | Live: sign up or sign in with a passkey, approve the agent; `whoami` names you. A `bsu_` personal token also works as a bearer |
| Task claim, `bean_open`, culprit diff and decision-card tools | **Coming** |

Update the skill, snippet and this table when those land.
