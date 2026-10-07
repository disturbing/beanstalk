/**
 * What git shows a person whose request carried no usable credential. Git prints a text/plain
 * error body as `remote:` lines once it gives up (after its password prompt, or at once when
 * prompts are off or a helper's answer was refused); the `WWW-Authenticate` realm is never
 * shown, so the body carries the whole message (docs/claude-opus/19, "Connecting git").
 */

export type HintReason = 'missing' | 'refused';

const CHALLENGE = { 'www-authenticate': 'Basic realm="Beanstalk"' } as const;

/** The 401 git gets for a missing or refused credential, pointing at the three ways in. */
export function notConnected(reason: HintReason, webUrl: string): Response {
  return new Response(hintText(reason, webUrl), {
    status: 401,
    headers: {
      ...CHALLENGE,
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function hintText(reason: HintReason, webUrl: string): string {
  const web = webUrl === '' ? 'the Beanstalk web app' : webUrl.replace(/\/+$/, '');
  const lead =
    reason === 'missing'
      ? 'Beanstalk: this git is not connected to your account yet. Pick one:'
      : 'Beanstalk: that credential was refused (expired, revoked, or not for this repository). Pick one:';
  return [
    lead,
    '  1. Claude Code (easiest): /beanstalk:setup',
    '     not installed? claude plugin marketplace add disturbing/beanstalk && claude plugin install beanstalk@beanstalk',
    `  2. HTTPS: make a token at ${web}/settings/tokens and paste it at git's password prompt`,
    '  3. CI and scripts: a deploy token in BEANSTALK_TOKEN (the repository page, tab "Env vars")',
    '',
  ].join('\n');
}
