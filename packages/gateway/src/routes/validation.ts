import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import { z } from 'zod';

import { RunId } from '@beanstalk/shared-race/ids';

/**
 * `zValidator` with the repo's error shape: 400 `{error: {code: 'invalid_request', message,
 * issues}}` instead of the library's default body.
 */
export function validate<Target extends keyof ValidationTargets, Schema extends z.ZodType>(
  target: Target,
  schema: Schema,
) {
  return zValidator(target, schema, (result, c) => {
    if (result.success) return undefined;
    return c.json(
      {
        error: {
          code: 'invalid_request',
          message: `invalid ${target}`,
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      },
      400,
    );
  });
}

export const RunParam = z.object({ run: RunId });
