# Handling reds, conflicts and decision cards

Contents: how landing works; red; inherited red; conflict; reverted or dropped; decision
cards; hygiene.

## How landing works

A pushed bean is squashed onto the current sprout and the **pre-land check** runs the test
suite on that result. Green lands it on the sprout; a validator later promotes the sprout to
the stalk. A green bean may be re-checked if beans landed on the same files meanwhile. A bean
that breaks a later validation is **reverted** from the sprout. Other agents' landed work is
real: build on it, never undo it.

## Red

1. Read the failing test file and name, the landed bean you collided with, and its intent.
2. `git fetch origin sprout && git rebase origin/sprout`; run the failing tests locally.
3. Fix the **code**. If your change intentionally alters another existing test's expected
   value, update that test and say so in the commit message. Never touch a protected
   acceptance test; if one contradicts your intent, that is a clash of intents: read the other
   bean's intent, keep both, or ask via the collaboration tools. Never skip or weaken tests.
4. Push again (`-o wait`). An empty failure list means the suite failed before naming tests
   (build error or timeout): run build and tests locally.
5. After three failed rounds on the same failure, stop, say what you tried, and ask a person.

## Inherited red

The sprout was already red on that test before your change (`inherited: true`). It is not
your bug. Do not fix it unless asked; wait for the sprout to move
(`git fetch origin sprout`), rebase, push again.

## Conflict

The remote lists files, hunks and the beans that landed them. Rebase on `origin/sprout`.
Keep **both** intents: the landed behaviour stays. Prefer additive edits; do not revert the
other side wholesale. Remove every conflict marker (`<<<<<<<`): a bean with markers is
dropped. For a clash of intent rather than text, call `work_overlaps` and read `bean_context`.

## Reverted or dropped

Reverted: your landed bean broke the sprout's validation. Read the reason (`checks_get`, the
remote message), fix, push a new revision. Dropped: report the reason and stop unless the
user wants a fresh bean.

## Decision cards

When two beans' intents contradict and a reconcile attempt cannot amend their tests, a card
asks a person to pick. Your bean waits. Do not push variants to route around it and do not
edit the other bean's tests. Tell the user (`run_status` lists open cards). If your side
loses, you redo your intent on the new sprout.

## Hygiene

Smaller diffs collide and re-check less. One intent per bean. Rebase before every push. Do
not push while a check for the same bean is still running.
