import { setupScript } from '../../src/setup/setup-scripts';

/** The POSIX setup script (the plugin's `scripts/beanstalk-setup.sh`), for this deployment. */
export function GET(request: Request): Response {
  return setupScript('sh', new URL(request.url).origin);
}
