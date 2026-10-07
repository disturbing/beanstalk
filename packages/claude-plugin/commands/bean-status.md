---
description: Show where your bean is (checking, landed, sent back, reverted, on the stalk) and what to do next
argument-hint: "[bean-name]"
allowed-tools: Bash(git fetch:*), Bash(git ls-remote:*), Bash(git show:*), Bash(git branch:*), Bash(git remote get-url:*), mcp__beanstalk__bean_status, mcp__beanstalk__checks_get
---

Report the status of bean `$ARGUMENTS` (default: the current `bean/<name>` branch, from
`git branch --show-current`). Follow the `beanstalk` skill, section "Reading results".

1. Git first: `git fetch origin 'refs/beans/*:refs/beans/*' sprout stalk` then
   `git show refs/beans/<name>/status` (the bean's status ref). If the ref is absent, or the
   verdict needs more, call the MCP `bean_status` tool with `repo` (`owner/name`, from
   `git remote get-url origin`) and the bean.
2. If it is red, `bean_status` names the failing tests and the landed beans it collided
   with, their intent and files; `checks_get` adds inherited and protected flags.
3. Say in one or two lines: the state, the single next action, and any open decision card.
   Do not push or edit anything unless the state is "sent back" and the user asked you to fix it.
