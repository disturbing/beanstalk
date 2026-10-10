// Deploys beanstalk-swarm (Worker, Durable Objects and the agent image, built by Docker) to the
// account in CLOUDFLARE_ACCOUNT_ID, with its two required secrets from research/swarm/.dev.vars
// (created with fresh random values when missing), uploaded with the deploy through a temporary
// secrets file readable only by you (`--secrets-file`; secrets not in it are kept). Values are
// never printed. Optional secrets are set by hand, typed at the prompt:
//   npx wrangler secret put OPENAI_API_KEY        # api-key mode
//   npx wrangler secret put GATEWAY_ADMIN_TOKEN   # token re-issue and gateway stop on a halt
//
//   CLOUDFLARE_ACCOUNT_ID=<id> node research/swarm/scripts/deploy.mjs
//
// This deploys only `beanstalk-swarm`; it never touches the gateway, web, MCP or site Workers.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV_VARS = path.join(PACKAGE, '.dev.vars');
const REQUIRED = {
  SWARM_ADMIN_TOKEN: () => randomBytes(32).toString('hex'),
  SEAT_KEY: () => randomBytes(32).toString('base64'),
};

if (!process.env.CLOUDFLARE_ACCOUNT_ID) {
  fail('set CLOUDFLARE_ACCOUNT_ID to the account to deploy to (wrangler whoami lists yours)');
}
const vars = ensureDevVars();
const directory = mkdtempSync(path.join(tmpdir(), 'swarm-secrets-'));
const secretsFile = path.join(directory, 'secrets.json');
try {
  const required = Object.fromEntries(Object.keys(REQUIRED).map((name) => [name, vars[name]]));
  writeFileSync(secretsFile, JSON.stringify(required), { mode: 0o600 });
  run(['wrangler', 'deploy', '--secrets-file', secretsFile]);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

function ensureDevVars() {
  const text = existsSync(DEV_VARS) ? readFileSync(DEV_VARS, 'utf8') : '';
  const found = Object.fromEntries(
    text
      .split('\n')
      .map((line) => line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^['"]|['"]$/g, '')]),
  );
  const added = [];
  for (const [name, make] of Object.entries(REQUIRED)) {
    if (!found[name]) {
      found[name] = make();
      added.push(name);
    }
  }
  if (added.length > 0) {
    const lines = added.map((name) => `${name}=${found[name]}`).join('\n');
    writeFileSync(DEV_VARS, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${lines}\n`, {
      mode: 0o600,
    });
    process.stdout.write(`generated ${added.join(', ')} in research/swarm/.dev.vars\n`);
  }
  return found;
}

function run(argv) {
  const result = spawnSync('npx', argv, {
    cwd: PACKAGE,
    stdio: 'inherit',
    env: { ...process.env, WRANGLER_DOCKER_BIN: path.join(PACKAGE, 'agent', 'docker-build.sh') },
    encoding: 'utf8',
  });
  if (result.status !== 0) fail(`npx ${argv.join(' ')} failed`);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
