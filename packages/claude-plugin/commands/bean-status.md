---
description: Show where your bean is (checking, landed, sent back, reverted, on the stalk) and what to do next
argument-hint: "[bean-name]"
allowed-tools: Bash(git fetch:*), Bash(git ls-remote:*), Bash(git show:*), Bash(git branch:*), mcp__beanstalk__change_status, mcp__beanstalk__checks_get
---

Report the status of bean `$ARGUMENTS` (default: the current `bean/<name>` branch, from
`git branch --show-current`). Follow the `beanstalk` skill, section "Reading results".

1. Git first: `git fetch origin 'refs/beans/*:refs/beans/*' sprout stalk` then
   `git show refs/beans/<name>/status` (the git-native status ref, coming). If the ref is
   absent, fall back to the MCP `change_status` tool.
2. If it is red, call `checks_get` for the failing tests and the bean it collided with.
3. Say in one or two lines: the state, the single next action, and any open decision card.
   Do not push or edit anything unless the state is "sent back" and the user asked you to fix it.
