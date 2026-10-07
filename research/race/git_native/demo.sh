#!/usr/bin/env bash
# The git-native flow with a real git client: clone a repository engine, land a bean with
# `git push -o wait`, collide with it from a parallel bean (red, with the remote's verdict),
# fix and land, see a refused push to the sprout and read a status ref. Only git and node.
#
#   BEANSTALK_GIT=https://<gateway>/git/<owner>/<repo>.git BEANSTALK_TOKEN=<git token> ./demo.sh
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

# Prints the command as typed (the credential helper shown by name only), then runs it.
run() { printf '\n$ %s\n' "$(printf '%s ' "$@" | sed "s|credential.helper=!f.* f |credential.helper=<token helper> |")"; "$@" 2>&1; }
note() { printf '\n# %s\n' "$*"; }

cd "$WORK"
note "clone with git's credential helper (the token is never in the URL or the output)"
# An empty helper first resets any helper the machine has (a keychain must not keep the token).
run git -c credential.helper= -c credential.helper="$HELPER" clone "$BEANSTALK_GIT" repo
cd repo
git config credential.helper ''
git config --add credential.helper "$HELPER"
run git fetch origin sprout stalk
run git switch -c base origin/sprout

note "bean 1: the project's first code, pushed as a bean and held for its verdict"
mkdir -p src test
cat > src/total.js <<'JS'
exports.total = (items) => items.reduce((sum, price) => sum + price, 0);
JS
cat > test/total.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const { total } = require('../src/total');
test('total sums the prices', () => assert.strictEqual(total([50, 50]), 100));
JS
git add -A && git commit -q -m "Add a total helper" -m "total(items) sums the prices of a cart." -m "Task: DEMO-1"
run git push -o wait origin HEAD:refs/heads/bean/add-total

note "two agents start from the same sprout"
run git fetch origin sprout
git switch -q -c discount origin/sprout
git branch -q tax origin/sprout

note "agent A, bean 2: discounts, built on total()"
cat > src/discount.js <<'JS'
const { total } = require('./total');
exports.discounted = (items, rate) => total(items) * (1 - rate);
JS
cat > test/discount.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const { discounted } = require('../src/discount');
test('a 10% discount on 100 is 90', () => assert.strictEqual(discounted([100], 0.1), 90));
JS
git add -A && git commit -q -m "Add percentage discounts" -m "discounted(items, rate) takes rate off the cart total." -m "Task: DEMO-2"
run git push -o wait origin HEAD:refs/heads/bean/add-discount

note "agent B, bean 3 (written in parallel, from the old sprout): tax inside total()"
git switch -q tax
cat > src/total.js <<'JS'
exports.total = (items) => items.reduce((sum, price) => sum + price, 0) * 1.1;
JS
cat > test/total.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const { total } = require('../src/total');
test('total includes 10% tax', () => assert.ok(Math.abs(total([50, 50]) - 110) < 1e-9));
JS
git add -A && git commit -q -m "Charge 10% tax in totals" -m "Every total includes a 10% sales tax." -m "Task: DEMO-3"
run git push -o wait origin HEAD:refs/heads/bean/tax-in-total || true

note "landing is never a push: the sprout refuses it"
run git push --force origin HEAD:refs/heads/sprout || true

note "the verdict is also a ref anyone can fetch"
run git fetch origin '+refs/beans/*:refs/beans/*'
run git cat-file -p refs/beans/tax-in-total/status

note "agent B fixes as told: rebase onto the sprout, keep both intents (tax as its own function)"
run git fetch origin sprout
run git rebase origin/sprout
cat > src/total.js <<'JS'
exports.total = (items) => items.reduce((sum, price) => sum + price, 0);
exports.totalWithTax = (items) => exports.total(items) * 1.1;
JS
cat > test/total.test.js <<'JS'
const test = require('node:test');
const assert = require('node:assert');
const { total, totalWithTax } = require('../src/total');
test('total sums the prices', () => assert.strictEqual(total([50, 50]), 100));
test('totalWithTax adds 10% tax', () => assert.ok(Math.abs(totalWithTax([50, 50]) - 110) < 1e-9));
JS
git add -A && git commit -q -m "Charge 10% tax as totalWithTax" -m "Keeps total() pre-tax for discounts."
run git push -f -o wait origin HEAD:refs/heads/bean/tax-in-total

note "the stalk follows once CI validates the sprout"
run git fetch origin sprout stalk '+refs/beans/*:refs/beans/*'
run git log --oneline -5 origin/sprout
run git cat-file -p refs/beans/tax-in-total/status
