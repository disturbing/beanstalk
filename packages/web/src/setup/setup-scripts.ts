/**
 * The setup scripts bundled in the Claude Code plugin, served by the web app for agents
 * without the plugin (`curl -fsSL <web>/setup.sh | sh -s -- detect`). The default Beanstalk
 * address inside them becomes this deployment's, so staging serves a script for staging.
 */
import powershell from '../../../claude-plugin/scripts/beanstalk-setup.ps1?raw';
import posix from '../../../claude-plugin/scripts/beanstalk-setup.sh?raw';

const PUBLIC_WEB = 'https://beanstalk-web.devaccounts-1password.workers.dev';

export function setupScript(kind: 'sh' | 'ps1', webOrigin: string): Response {
  const body = (kind === 'sh' ? posix : powershell).split(PUBLIC_WEB).join(webOrigin);
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'x-content-type-options': 'nosniff',
    },
  });
}
