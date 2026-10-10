// Mints a view or contributor token for one run, for any MCP client:
//
//   pnpm -F @gitstalk/mcp mint-token <run> [--gateway <url>]
//   export BEANSTALK_TOKEN=$(pnpm -s -F @gitstalk/mcp mint-token <run> --gateway https://beanstalk-gateway.<sub>.workers.dev)
//
// Add --bean <bean> --actor <actor> for a contributor token. The admin token comes from
// ADMIN_TOKEN, else packages/gateway/.dev.vars; it is never printed. Only the token goes
// to stdout; its expiry goes to stderr. The gateway defaults to BEANSTALK_GATEWAY_URL, else
// a local `wrangler dev` on http://localhost:8787.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
const DEV_VARS = path.join(here, '../../gateway/.dev.vars');
const RUN_ID = /^[a-z0-9]{6,24}$/;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    gateway: { type: 'string' },
    bean: { type: 'string' },
    actor: { type: 'string' },
    'ttl-seconds': { type: 'string' },
  },
});
const run = positionals[0] ?? '';
if (!RUN_ID.test(run) || positionals.length !== 1)
  fail(
    'usage: token <run> [--gateway <url>] [--bean <bean> --actor <actor> [--ttl-seconds <seconds>]]',
  );

const contributor = contributorInput(values);
const scope = contributor === undefined ? 'view' : 'contributor';

const gateway = values.gateway ?? process.env.BEANSTALK_GATEWAY_URL ?? 'http://localhost:8787';
const response = await fetch(new URL(`/v1/runs/${run}/${scope}-token`, gateway), {
  method: 'POST',
  headers: { authorization: `Bearer ${adminToken()}`, 'content-type': 'application/json' },
  ...(contributor === undefined ? {} : { body: JSON.stringify(contributor) }),
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) fail(`the gateway answered ${response.status}: ${await response.text()}`);
const body = await response.json();
if (typeof body?.token !== 'string') fail('the gateway answered without a token');
process.stderr.write(`${scope} token for run ${run}, valid until ${body.expires_at}\n`);
process.stdout.write(`${body.token}\n`);

function contributorInput(options) {
  if (options.bean === undefined && options.actor === undefined) {
    if (options['ttl-seconds'] !== undefined) fail('--ttl-seconds requires --bean and --actor');
    return undefined;
  }
  if (options.bean === undefined || options.actor === undefined)
    fail('contributor tokens require both --bean and --actor');
  const bean = options.bean.replace(/^beans\//, '');
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(bean) ||
    bean.endsWith('.lock') ||
    bean.includes('..')
  )
    fail('--bean must be a bean id or beans/<id>');
  const actor = options.actor.trim();
  if (actor.length === 0 || actor.length > 32) fail('--actor must contain 1 to 32 characters');
  if (options['ttl-seconds'] === undefined) return { bean, actor };
  const ttlSeconds = Number(options['ttl-seconds']);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 86_400)
    fail('--ttl-seconds must be an integer from 60 to 86400');
  return { bean, actor, ttl_seconds: ttlSeconds };
}

function adminToken() {
  const fromEnv = process.env.ADMIN_TOKEN;
  if (fromEnv) return fromEnv;
  if (!existsSync(DEV_VARS)) fail('set ADMIN_TOKEN, or add it to packages/gateway/.dev.vars');
  const line = readFileSync(DEV_VARS, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith('ADMIN_TOKEN='));
  const value = line
    ?.slice('ADMIN_TOKEN='.length)
    .trim()
    .replace(/^"(.*)"$/, '$1');
  if (!value) fail('packages/gateway/.dev.vars has no ADMIN_TOKEN');
  return value;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}
