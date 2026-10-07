import { env } from 'cloudflare:workers';

import { pollKeyRequest } from '@beanstalk/shared-identity/ssh-key-requests';

import { problem } from '../../../../src/auth/http';
import { PollBody, pollAnswer } from '../../../../src/setup/setup-api';

/** The outcome of a key request, for the terminal holding its poll secret. */
export async function POST(request: Request): Promise<Response> {
  const body = PollBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return problem(400, 'invalid_request', 'send poll_token');
  return Response.json(pollAnswer(await pollKeyRequest(env, body.data.poll_token)), {
    headers: { 'cache-control': 'no-store' },
  });
}
