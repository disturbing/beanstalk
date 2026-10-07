import { connectedSessions } from '../../../src/auth/connected-sessions';
import { getUser } from '../../../src/auth/user';
import { problem } from '../../../src/auth/http';

/**
 * The signed-in person's connected agent sessions, for Home's "Your sessions" (it asks every
 * few seconds until one connects). Same-origin reads only: no CORS headers are sent.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getUser(request);
  if (user === null) return problem(401, 'unauthorized', 'sign in first');
  const sessions = await connectedSessions(user.id);
  if (sessions === null) return problem(503, 'unavailable', 'sessions could not be listed');
  return Response.json({ sessions }, { headers: { 'cache-control': 'no-store' } });
}
