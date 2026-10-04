// Mints a view token for one run, for the MCP server and the Claude Code plugin:
//
//   pnpm -F @beanstalk/mcp mint-token <run> [--gateway <url>]
//   export BEANSTALK_TOKEN=$(pnpm -s -F @beanstalk/mcp mint-token <run> --gateway https://beanstalk-gateway.<sub>.workers.dev)
//
// Calls the gateway's admin route POST /v1/runs/<run>/view-token. The admin token comes from
// ADMIN_TOKEN, else packages/gateway/.dev.vars; it is never printed. Only the view token goes
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
  options: { gateway: { type: 'string' } },
});
const run = positionals[0] ?? '';
if (!RUN_ID.test(run))
  fail('usage: token <run> [--gateway <url>]  (run: 6 to 24 lowercase letters or digits)');

const gateway = values.gateway ?? process.env.BEANSTALK_GATEWAY_URL ?? 'http://localhost:8787';
const response = await fetch(new URL(`/v1/runs/${run}/view-token`, gateway), {
  method: 'POST',
  headers: { authorization: `Bearer ${adminToken()}` },
  signal: AbortSignal.timeout(15_000),
});
if (!response.ok) fail(`the gateway answered ${response.status}: ${await response.text()}`);
const body = await response.json();
if (typeof body?.token !== 'string') fail('the gateway answered without a token');
process.stderr.write(`view token for run ${run}, valid until ${body.expires_at}\n`);
process.stdout.write(`${body.token}\n`);

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
