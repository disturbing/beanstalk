/**
 * The run repo's two lines (plan §6 naming): the **sprout** is the staged line, where beans
 * land once their pre-land check passed (the harness's `trunk`); the **stalk** is the stable
 * line, moved only to validated commits (the harness's `green`). Events keep the harness's
 * names (`trunk_idx`, `green.promote`) so its analysis tools read cloud runs unchanged.
 */
export const SPROUT_REF = 'refs/heads/sprout';
export const STALK_REF = 'refs/heads/stalk';
