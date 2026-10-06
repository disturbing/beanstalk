import { createRequire, builtinModules } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const source = '/Users/coop/Workspace/beanstalk';
const runtime = '/private/tmp/beanstalk-three-agent-trial';
const fromMcp = createRequire(path.join(source, 'packages/mcp/package.json'));
const fromWrangler = createRequire(fromMcp.resolve('wrangler'));
const fromPool = createRequire(realpathSync(path.join(source, 'packages/mcp/node_modules/@cloudflare/vitest-pool-workers/package.json')));
const { Miniflare, Log, LogLevel, convertV4MiniflareOptions } = fromWrangler('miniflare');
const { buildSync } = fromWrangler('esbuild');
const fromMiniflare = createRequire(fromWrangler.resolve('miniflare'));
const compatibilityDate = fromMiniflare('workerd').compatibilityDate;
const origin = 'http://127.0.0.1:8894';
const privateFile = path.join(runtime, 'private/session.json');
const session = existsSync(privateFile)
  ? JSON.parse(readFileSync(privateFile, 'utf8'))
  : { admin: randomBytes(32).toString('hex'), signing: randomBytes(32).toString('hex') };
writeFileSync(privateFile, JSON.stringify(session), { mode: 0o600 });
mkdirSync(path.join(runtime, 'bundle'), { recursive: true });

function bundle(packageName) {
  const outfile = path.join(runtime, 'bundle', `${packageName}.js`);
  // Keep the trial on one reviewed code snapshot even if the shared checkout changes.
  if (existsSync(outfile)) return readFileSync(outfile, 'utf8');
  buildSync({
    entryPoints: [path.join(source, 'packages', packageName, 'src/index.ts')],
    outfile, bundle: true, format: 'esm', platform: 'neutral', target: 'es2024',
    conditions: ['workerd', 'worker', 'browser'],
    external: ['cloudflare:*', 'workerd:*', 'node:*', ...builtinModules],
  });
  return readFileSync(outfile, 'utf8');
}

const legacyOptions = convertV4MiniflareOptions({
  host: '127.0.0.1', port: 8894,
  log: new Log(LogLevel.ERROR),
  workers: [
    {
      name: 'trial-front', modules: true, compatibilityDate,
      serviceBindings: { MCP: 'beanstalk-mcp', GATEWAY: 'beanstalk-gateway' },
      script: `export default { fetch(request, env) {
        return new URL(request.url).pathname === '/mcp'
          ? env.MCP.fetch(request) : env.GATEWAY.fetch(request);
      } };`,
    },
    {
      name: 'beanstalk-mcp', modules: true, script: bundle('mcp'),
      compatibilityDate, compatibilityFlags: ['nodejs_compat'],
      bindings: { LOG_LEVEL: 'error', WEB_URL: origin, ASK_CLASSIFIER: 'keywords', PICKER: 'rules' },
      serviceBindings: { GATEWAY: 'beanstalk-gateway' },
    },
    {
      name: 'beanstalk-gateway', modules: true, script: bundle('gateway'),
      compatibilityDate, compatibilityFlags: ['nodejs_compat'],
      bindings: { ADMIN_TOKEN: session.admin, RUN_TOKEN_SECRET: session.signing,
        LOG_LEVEL: 'error', ARTIFACTS_NAMESPACE: 'beanstalk-race',
        RUN_TOKEN_TTL_SECONDS: '3600', ARTIFACTS_TOKEN_TTL_SECONDS: '600' },
      serviceBindings: { ARTIFACTS: { name: 'fake-artifacts', entrypoint: 'FakeArtifacts' } },
      durableObjects: {
        RUNS: { className: 'RunDO', useSQLite: true },
        RUN_INDEX: { className: 'RunIndex', useSQLite: true },
        RUNNER: { className: 'FakeRunner', scriptName: 'fake-runner' },
      },
      outboundService: { name: 'fake-artifacts', entrypoint: 'FakeGitRemote' },
    },
    {
      name: 'fake-artifacts', modules: true, compatibilityDate,
      script: readFileSync(path.join(source, 'packages/gateway/test/fakes/fake-artifacts.js'), 'utf8'),
    },
    {
      name: 'fake-runner', modules: true, compatibilityDate,
      script: readFileSync(path.join(source, 'packages/gateway/test/fakes/fake-runner.js'), 'utf8'),
      durableObjects: { FAKE_RUNNER: { className: 'FakeRunner', useSQLite: true } },
    },
  ],
});
const miniflare = new Miniflare({ ...legacyOptions,
  resourcePersistencePath: path.join(runtime, 'state'),
});

await miniflare.ready;

async function adminPost(endpoint, body) {
  const response = await fetch(`${origin}${endpoint}`, {
    method: 'POST', headers: { authorization: `Bearer ${session.admin}`, 'content-type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`admin request failed: ${response.status} ${JSON.stringify(result)}`);
  return result;
}

const roles = [
  { role: 'shipping', bean: 't001', title: 'Shipping estimates with business days', module: 'shipping' },
  { role: 'checkout', bean: 't002', title: 'Checkout delivery estimate display', module: 'checkout' },
  { role: 'returns', bean: 't003', title: 'Calendar-day returns deadline', module: 'returns' },
];
if (session.run === undefined) {
  const created = await adminPost('/v1/runs', {
    policy: 'queue', agents: 3, ci_seconds: 0, keep_repo: true,
    tasks: roles.map(({ bean, title, module }) => ({
      id: bean, title, prompt: `${title}. Independently negotiate precise shared shipping semantics through bean tools.`,
      acceptance_tests: { [`tests/${module}.test.mjs`]: `// Acceptance tests live in the fresh demo repo.\n` },
      oracle_paths: [`src/${module}.mjs`], oracle_modules: ['src'], kind: 'feature', difficulty: 1, couplings: [],
    })),
  });
  session.run = created.run;
  session.view = created.view.token;
  writeFileSync(privateFile, JSON.stringify(session), { mode: 0o600 });
  for (const { role, bean } of roles) {
    const grant = await adminPost(`/v1/runs/${session.run}/contributor-token`, {
      bean, actor: `trial-${role}`, ttl_seconds: 86_400,
    });
    writeFileSync(path.join(runtime, 'private', `${role}.json`), JSON.stringify({
      run: session.run, bean, role, origin, token: grant.token,
    }), { mode: 0o600 });
  }
  writeFileSync(path.join(runtime, 'private', 'view.json'), JSON.stringify({
    run: session.run, role: 'view', origin, token: session.view,
  }), { mode: 0o600 });
}
writeFileSync(path.join(runtime, 'ready.json'), JSON.stringify({
  run: session.run, origin, pid: process.pid, compatibilityDate,
  roles: roles.map(({ role, bean }) => ({ role, bean })),
  persisted_sqlite: true, external_artifacts: 'local test stand-in', runner: 'local test stand-in',
}, null, 2));
process.stdout.write(`${JSON.stringify({ ready: true, run: session.run, origin, pid: process.pid })}\n`);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await miniflare.dispose();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
