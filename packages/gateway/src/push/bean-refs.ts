/**
 * The refs of the git-native flow (`docs/claude-opus/18-git-native-flow.md`). A person or an
 * agent pushes `refs/heads/bean/<name>`; the engine names a bean's branch `beans/<task>` (its
 * race heritage), so the shell translates where the two meet (the squash's change ref and the
 * explorer's reads). Each bean's verdict is published as an annotated tag at
 * `refs/beans/<name>/status`.
 */
import { TaskId } from '@beanstalk/shared-race/ids';

/** The branch prefix a push creates or updates a bean under. */
export const PUSHED_BEAN_PREFIX = 'refs/heads/bean/';
/** The engine's bean branches (`taskBranch`). */
const ENGINE_BEAN_PREFIX = 'refs/heads/beans/';

/** Lines that are never pushed: landing on them is the engine's alone. */
export const PROTECTED_BRANCHES: readonly string[] = [
  'refs/heads/sprout',
  'refs/heads/stalk',
  'refs/heads/main',
];

/** The pushed branch of bean `name`. */
export function pushedBeanRef(name: string): string {
  return `${PUSHED_BEAN_PREFIX}${name}`;
}

/** The status ref of bean `name` (an annotated tag on the bean's head). */
export function beanStatusRef(name: string): string {
  return `refs/beans/${name}/status`;
}

/** The bean a pushed ref names, when it is a valid `refs/heads/bean/<name>`; else null. */
export function beanOfPushedRef(ref: string): TaskId | null {
  if (!ref.startsWith(PUSHED_BEAN_PREFIX)) return null;
  const parsed = TaskId.safeParse(ref.slice(PUSHED_BEAN_PREFIX.length));
  return parsed.success ? parsed.data : null;
}

/** A ref as a continuous engine's repo holds it: `refs/heads/beans/x` is `refs/heads/bean/x`. */
export function continuousRef(ref: string): string {
  return ref.startsWith(ENGINE_BEAN_PREFIX)
    ? `${PUSHED_BEAN_PREFIX}${ref.slice(ENGINE_BEAN_PREFIX.length)}`
    : ref;
}
