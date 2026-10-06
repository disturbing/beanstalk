// Deploys beanstalk to one Cloudflare account, in dependency order: the gateway (with the
// runner container, built by Docker), the web app and the MCP server (both bind to the
// gateway; the MCP server links to the web app), then the marketing site.
//
//   CLOUDFLARE_ACCOUNT_ID=<id> node scripts/deploy-all.mjs [--dry-run] [--only gateway,web,mcp,site]
//
// Secrets come from each package's .dev.vars (created from .dev.vars.example with fresh
// random values when missing) and are uploaded with the deploy (`--secrets-file`). Nothing
// account-specific lives in the repo: the account comes from CLOUDFLARE_ACCOUNT_ID, and the
// web app's URL that the MCP server links to is read from the web deploy's output.
// `--dry-run` builds and checks every Worker without uploading anything.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = ['gateway', 'web', 'mcp', 'site'];
/** Secrets each package needs in its .dev.vars (generated when absent). */
const SECRETS = {
  gateway: ['ADMIN_TOKEN', 'RUN_TOKEN_SECRET'],
  web: ['DEMO_PASSWORD'],
  mcp: [],
  site: [],
};

const options = parseArgs(process.argv.slice(2));
requireAccount(options);
if (options.only.includes('gateway') && !options.dryRun) requireDocker();

const urls = {};
for (const name of options.only) {
  const secretsFile = options.dryRun ? null : ensureSecrets(name);
  urls[name] = deploy(name, { secretsFile, dryRun: options.dryRun, webUrl: urls.web });
}
report(urls, options);

function parseArgs(args) {
  const only = valueOf(args, '--only')?.split(',') ?? PACKAGES;
  const unknown = only.filter((name) => !PACKAGES.includes(name));
  if (unknown.length > 0) fail(`unknown package(s): ${unknown.join(', ')}`);
  return {
    dryRun: args.includes('--dry-run'),
    only: PACKAGES.filter((name) => only.includes(name)),
  };
}

function valueOf(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

/** A deploy goes to exactly the account named, never to whichever one Wrangler defaults to. */
function requireAccount({ dryRun }) {
  if (dryRun || process.env.CLOUDFLARE_ACCOUNT_ID) return;
  fail('set CLOUDFLARE_ACCOUNT_ID to the account to deploy to (wrangler whoami lists yours)');
}

function requireDocker() {
  const docker = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (docker.status !== 0)
    fail('the gateway builds the runner container image: start Docker first');
}

/** The package's .dev.vars, with every required secret set (missing ones generated). */
function ensureSecrets(name) {
  const required = SECRETS[name];
  if (required.length === 0) return null;
  const file = path.join(ROOT, 'packages', name, '.dev.vars');
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  const values = new Map(
    lines
      .map((line) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line))
      .filter((match) => match !== null)
      .map((match) => [match[1], match[2].replace(/^["']|["']$/g, '')]),
  );
  const missing = required.filter((key) => !values.get(key));
  if (missing.length > 0) {
    const kept = lines.filter((line) => !missing.some((key) => line.startsWith(`${key}=`)));
    const added = missing.map((key) => `${key}=${randomBytes(32).toString('base64url')}`);
    writeFileSync(file, `${[...kept.filter((line) => line.trim() !== ''), ...added].join('\n')}\n`);
    console.log(`${name}: generated ${missing.join(', ')} in ${path.relative(ROOT, file)}`);
  }
  return file;
}

/** Deploys one package and returns its workers.dev URL (null when dry or not printed). */
function deploy(name, { secretsFile, dryRun, webUrl }) {
  const cwd = path.join(ROOT, 'packages', name);
  console.log(`\n== ${name}${dryRun ? ' (dry run)' : ''}`);
  if (name === 'web') run('pnpm', ['build'], cwd);
  const args = ['wrangler', 'deploy'];
  if (name === 'web') args.push('--config', 'dist/server/wrangler.json');
  if (secretsFile !== null && !dryRun) args.push('--secrets-file', secretsFile);
  if (name === 'mcp' && webUrl) args.push('--var', `WEB_URL:${webUrl}`);
  if (dryRun) args.push('--dry-run');
  const output = run('npx', args, cwd);
  return /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(output)?.[0] ?? null;
}

/** Runs a command in `cwd`, echoing its output, and returns its stdout; exits on failure. */
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit'],
  });
  process.stdout.write(result.stdout ?? '');
  if (result.status !== 0)
    fail(`${command} ${args.join(' ')} failed in ${path.relative(ROOT, cwd)}`);
  return result.stdout ?? '';
}

function report(deployed, { dryRun }) {
  console.log('\n== done');
  for (const [name, url] of Object.entries(deployed))
    console.log(`${name}: ${url ?? (dryRun ? 'checked' : 'deployed')}`);
  if (deployed.mcp && !deployed.web)
    console.log(
      'mcp: WEB_URL kept from wrangler.jsonc (deploy web in the same run to link to yours)',
    );
  if (deployed.gateway)
    console.log(
      `\nRun a replay race:\n  cd research/race && python3 race.py --forge cloudflare --gateway ${deployed.gateway} ` +
        '--policy beanstalk-v2 --preset demo --agent replay --agents 8 --ci-seconds 4.5 --ci-slots 2 --seed 7 ' +
        '--preland-mode optimistic --preland-seconds 4.5 --decision-seconds 1 --max-usd 5 --out runs/my-replay',
    );
}

function fail(message) {
  console.error(`deploy-all: ${message}`);
  process.exit(1);
}
