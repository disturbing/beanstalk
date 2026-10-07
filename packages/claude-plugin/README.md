# Beanstalk plugin for Claude Code

Teaches a coding agent to work on a Beanstalk repository: git is the interface (clone, branch
`bean/<name>`, commit with the intent, `git push` submits the bean, read the `remote:` verdict,
rebase on the sprout and fix reds), and the `beanstalk` MCP server is optional context
(`work_overlaps`, `ask_repo`, `checks_get`, decision cards, bean-to-bean conversation).

## Install and connect, in one line

```bash
claude plugin marketplace add disturbing/beanstalk && claude plugin install beanstalk@beanstalk && claude "/beanstalk:setup <owner>/<repo>"
```

`/beanstalk:setup` connects git to your account once: Claude lists the SSH keys this machine
has (1Password's SSH agent, ssh-agent, `~/.ssh`) or offers to make one, asks which to use, and
a Beanstalk tab opens for you to approve it (one click when signed in; a passkey otherwise).
On a machine without a browser (SSH) it shows a code to enter on another device. After that
git never asks for a password. Until Beanstalk's SSH endpoint is live, setup also stores an
HTTPS token in your OS keychain through git's own credential helper, for the Beanstalk host
only, and says so.

For MCP (optional): `/mcp` in a session, sign in, approve.

## Without Claude Code

- **Codex and other agents:** `codex mcp add beanstalk --url <mcp>/mcp && codex mcp login beanstalk`,
  then ask the agent to run `curl -fsSL <web>/setup.sh | sh -s -- detect`, ask you which key to
  use, and finish with the same script's `register` and `remote <owner>/<repo>`
  (`AGENTS-snippet.md` says this for them). Windows: `<web>/setup.ps1`.
- **By hand, HTTPS:** clone, and paste a personal token (Settings, Tokens) at git's password
  prompt.
- **CI and scripts:** a deploy token for one repository in `BEANSTALK_TOKEN`, with
  `GIT_TERMINAL_PROMPT=0` and `GIT_CONFIG_COUNT=1` / `GIT_CONFIG_KEY_0='credential.https://<gateway>.helper'`
  / `GIT_CONFIG_VALUE_0='!f() { echo "username=x"; echo "password=$BEANSTALK_TOKEN"; }; f'`
  (the repository page, tab "Env vars", fills it in).

## Contents

| File | What |
|---|---|
| `.claude-plugin/plugin.json` | Manifest |
| `.mcp.json` | MCP server (HTTP, no auth header so the client uses OAuth) |
| `commands/setup.md` | `/beanstalk:setup [owner/repo]`: connect git (SSH key, browser approval) |
| `commands/bean-status.md` | `/beanstalk:bean-status [bean]` |
| `scripts/beanstalk-setup.sh`, `.ps1` | The setup script (POSIX sh: macOS, Linux, WSL, Git Bash; PowerShell: Windows) |
| `skills/beanstalk/` | `SKILL.md` plus `references/` (push flow, MCP tools, reds/conflicts/cards) |
| `AGENTS-snippet.md` | The same guidance, compact, to paste into a repo's `AGENTS.md` (Codex, Cursor, Copilot, Gemini CLI) |
| `test/` | Script tests: `sh test/setup-tests.sh` (macOS), `sh test/run-containers.sh` (Linux sh and PowerShell in Docker) |

From a checkout: `claude --plugin-dir packages/claude-plugin`; `claude plugin validate .` checks
the marketplace, `claude plugin validate packages/claude-plugin` the plugin. A branch other than
the default is named as `disturbing/beanstalk#<branch>`. `BEANSTALK_MCP_URL` and
`BEANSTALK_WEB` point at another deployment.

## Status of the server side

| Feature | State |
|---|---|
| MCP read tools, collaboration tools | Live |
| MCP repository tools: `repo_list`, `repo_status`, `bean_open`, `bean_status`, `bean_wait`, `task_list`, `task_claim`, `git_credentials` | Built (`docs/claude-opus/22-mcp-repository-tools.md`); on staging, not yet deployed live |
| Git-native intake (`bean/<name>`, push options, `remote:` verdicts, `refs/beans/<name>/status`) | Live on people's repositories (`https://<gateway>/git/<owner>/<repo>.git`) |
| `/beanstalk:setup`, SSH keys in Settings, deploy tokens | Live; git over SSH itself is **coming** (HTTPS with a token until then) |
| MCP OAuth (`claude mcp login`, `/mcp`) | Live: sign up or sign in with a passkey, approve the agent; `whoami` names you |
| Decision-card tools | **Coming** |

Update the skill, snippet and this table when those land.
