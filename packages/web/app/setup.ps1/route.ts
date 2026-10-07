import { setupScript } from '../../src/setup/setup-scripts';

/** The PowerShell setup script (the plugin's `scripts/beanstalk-setup.ps1`), for this deployment. */
export function GET(request: Request): Response {
  return setupScript('ps1', new URL(request.url).origin);
}
