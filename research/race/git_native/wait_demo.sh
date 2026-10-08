#!/usr/bin/env bash
# Waiting for verdicts in plain git, without polling (docs/claude-opus/18-git-native-flow.md §4.1):
# push two beans without waiting, then one blocking `git push origin HEAD:refs/wait/any` that
# the first verdict wakes; a new commit to the bean still in check is refused with the command to
# wait; `refs/wait/all` re-attaches to it and wakes at its verdict. Only git and node.
#
#   BEANSTALK_GIT=https://<gateway>/git/<owner>/<repo>.git BEANSTALK_TOKEN=<git token> ./wait_demo.sh
#
# The token reaches git through its standard credential helper and is never printed.
set -euo pipefail
: "${BEANSTALK_GIT:?the clone URL of the repository}" "${BEANSTALK_TOKEN:?a git token}"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
export GIT_AUTHOR_NAME=demo GIT_AUTHOR_EMAIL=demo@beanstalk.invalid
export GIT_COMMITTER_NAME=demo GIT_COMMITTER_EMAIL=demo@beanstalk.invalid
export GIT_TERMINAL_PROMPT=0
HELPER='!f() { echo username=x; echo "password=$BEANSTALK_TOKEN"; }; f'

# Prints the command as typed (the credential helper shown by name only), runs it, and says how
# long it took and how it exited.
run() {
  printf '\n$ %s\n' "$(printf '%s ' "$@" | sed "s|credential.helper=!f.* f |credential.helper=<token helper> |")"
  local start=$SECONDS
  "$@" > "$WORK/last.out" 2>&1 && status=0 || status=$?
  cat "$WORK/last.out"
  printf '# (exit %s after %s s)\n' "$status" "$((SECONDS - start))"
  return "$status"
}
expect() { grep -q "$1" "$WORK/last.out" || { printf '\n# expected "%s"; stopping\n' "$1"; exit 1; }; }
refuse() { if grep -q "$1" "$WORK/last.out"; then printf '\n# unexpected "%s"; stopping\n' "$1"; exit 1; fi; }
note() { printf '\n# %s\n' "$*"; }
commit_test() { # <file> <test body>
  mkdir -p test
  printf "const test = require('node:test');\nconst assert = require('node:assert');\n%s\n" "$2" > "test/$1"
}

cd "$WORK"
note "clone with git's credential helper (the token is never in the URL or the output)"
run git -c credential.helper= -c credential.helper="$HELPER" clone "$BEANSTALK_GIT" repo
cd repo
git config credential.helper ''
git config --add credential.helper "$HELPER"
run git fetch origin sprout
git switch -q -c fast origin/sprout
git branch -q slow origin/sprout

note "bean 1 (fast): pushed plainly; the push returns once the bean is received"
commit_test fast.test.js "test('fast', () => assert.strictEqual(1 + 1, 2));"
git add -A && git commit -q -m "Add a fast check" -m "Task: EV-1"
run git push origin HEAD:refs/heads/bean/ev-fast
expect "pre-land check started"
refuse "LANDED"

note "bean 2 (slow, a 40 s test), from the same sprout, also pushed without waiting"
git switch -q slow
commit_test slow.test.js "test('slow', async () => { await new Promise((r) => setTimeout(r, 40000)); assert.ok(true); });"
git add -A && git commit -q -m "Add a slow check" -m "Task: EV-2"
run git push origin HEAD:refs/heads/bean/ev-slow
expect "pre-land check started"

note "out of work: one blocking call, woken by the first verdict (no sleep, no polling)"
run git push -o bean=ev-fast -o bean=ev-slow origin HEAD:refs/wait/any
expect "verdict for ev-fast"
expect "ev-slow (checking)"

note "a new commit to the bean still in check is refused, with the command to wait for it"
commit_test slow.test.js "test('slow', async () => { await new Promise((r) => setTimeout(r, 40000)); assert.strictEqual(2, 2); });"
git commit -q -am "Tighten the slow check"
run git push -f origin HEAD:refs/heads/bean/ev-slow || true
expect "is being checked"
git reset -q --hard HEAD~1

note "re-attach to it: wait for every verdict of the beans still in check"
run git push -o bean=ev-slow origin HEAD:refs/wait/all
expect "verdict for ev-slow"

note "the wait stored nothing: no refs/wait on the remote; the verdicts are on the status refs"
run git ls-remote origin
refuse "refs/wait"
run git fetch -q origin '+refs/beans/*:refs/beans/*'
run git for-each-ref 'refs/beans/' --format='%(refname:lstrip=2) %(contents:subject)'
