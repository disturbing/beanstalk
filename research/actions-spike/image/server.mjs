// Actions spike container server (throwaway). Three endpoints, all streaming plain text:
//   GET  /health            -> {"ok":true,"uptime_ms":…,"boot_ms":…}
//   POST /run   {files, event, event_name, job?, args?, secrets?, env?}
//        writes `files` into a fresh git repo, writes the event payload, runs
//        `act <event_name> -P ubuntu-latest=-self-hosted -e event.json …args` there and streams
//        stdout+stderr; the last line is `##[spike] exit=<code> wall_ms=<ms>`.
//   POST /exec  {cmd, timeout_s?}  -> `bash -lc cmd`, streamed, same trailer.
// Secrets arrive in the body and are passed to act through a 0600 file, never argv.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8080);
const WORK_ROOT = process.env.WORK_ROOT ?? '/work';
const BOOT = Date.now();
let seq = 0;

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function stream(res, command, args, options, timeoutS) {
  const started = Date.now();
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.write(`##[spike] start ${new Date(started).toISOString()} ${command} ${args.join(' ')}\n`);
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (c) => res.write(c));
  child.stderr.on('data', (c) => res.write(c));
  const timer = setTimeout(() => child.kill('SIGKILL'), (timeoutS ?? 1800) * 1000);
  child.on('close', (code, signal) => {
    clearTimeout(timer);
    res.end(`\n##[spike] exit=${code ?? signal} wall_ms=${Date.now() - started}\n`);
  });
  child.on('error', (error) => {
    clearTimeout(timer);
    res.end(`\n##[spike] spawn-error ${error.message}\n`);
  });
}

async function run(req, res) {
  const body = await readJson(req);
  const dir = join(WORK_ROOT, `job-${Date.now()}-${seq++}`);
  mkdirSync(dir, { recursive: true });
  for (const [path, content] of Object.entries(body.files ?? {})) {
    const full = join(dir, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  const meta = join(WORK_ROOT, `${dir.split('/').pop()}.meta`);
  mkdirSync(meta, { recursive: true });
  writeFileSync(join(meta, 'event.json'), JSON.stringify(body.event ?? {}));
  const secretsFile = join(meta, 'secrets.env');
  writeFileSync(
    secretsFile,
    Object.entries(body.secrets ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  );
  chmodSync(secretsFile, 0o600);
  const prelude = [
    'set -e',
    `cd ${dir}`,
    'git init -q -b main',
    'git -c user.email=spike@beanstalk -c user.name=spike add -A',
    'git -c user.email=spike@beanstalk -c user.name=spike commit -qm spike',
    // act derives GITHUB_REPOSITORY (and the default checkout target) from the origin remote.
    ...(body.origin ? [`git remote add origin '${body.origin}'`] : []),
  ].join(' && ');
  const actArgs = [
    body.event_name ?? 'push',
    '-P',
    'ubuntu-latest=-self-hosted',
    '-e',
    join(meta, 'event.json'),
    '--secret-file',
    secretsFile,
    ...(body.job ? ['-j', body.job] : []),
    ...(body.args ?? []),
  ];
  const quoted = actArgs.map((a) => `'${String(a).replaceAll("'", "'\\''")}'`).join(' ');
  stream(
    res,
    'bash',
    ['-lc', `${prelude} && exec act ${quoted}`],
    { cwd: WORK_ROOT, env: { ...process.env, ...(body.env ?? {}) } },
    body.timeout_s,
  );
}

async function exec(req, res) {
  const body = await readJson(req);
  stream(res, 'bash', ['-lc', String(body.cmd ?? 'true')], { cwd: WORK_ROOT }, body.timeout_s);
}

mkdirSync(WORK_ROOT, { recursive: true });
createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const handler =
    req.method === 'POST' && path === '/run'
      ? run
      : req.method === 'POST' && path === '/exec'
        ? exec
        : null;
  if (path === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, uptime_ms: Date.now() - BOOT, process_uptime_s: process.uptime() }));
    return;
  }
  if (handler === null) {
    res.writeHead(404).end('not found\n');
    return;
  }
  handler(req, res).catch((error) => {
    if (!res.headersSent) res.writeHead(500);
    res.end(`##[spike] server-error ${error.message}\n`);
  });
}).listen(PORT, '0.0.0.0');
