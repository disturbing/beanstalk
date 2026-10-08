// Throwaway: POST /run {project, registry?} -> fresh dir + empty npm cache, `npm ci`, timings.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const server = createServer(async (req, res) => {
  if (req.url === '/health') return res.end('ok\n');
  if (req.url !== '/run' || req.method !== 'POST') {
    res.statusCode = 404;
    return res.end('not found\n');
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const { project, registry, mode, root, args } = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  if (root === '/mnt/ram') execFileSync('sh', ['-c', 'mkdir -p /mnt/ram && (mountpoint -q /mnt/ram || mount -t tmpfs -o size=3g tmpfs /mnt/ram)']);
  const dir = mkdtempSync(join(root ?? tmpdir(), 'job-'));
  const cache = join(dir, '.npm-cache');
  mkdirSync(cache);
  cpSync(join('/spike/projects', project), dir, { recursive: true });
  const base = ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', cache, '--loglevel', 'http'];
  const cpu = () => { const f = readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number); return { busy: f[0] + f[1] + f[2] + f[5] + f[6], total: f.reduce((a, b) => a + b, 0) }; };
  const ci = async (extra) => {
    const c0 = cpu();
    const t0 = performance.now();
    const child = spawn('npm', [...base, ...extra], { cwd: dir, env: { ...process.env, CI: '1' } });
    let err = '';
    let requests = 0;
    child.stderr.on('data', (d) => {
      const s = d.toString();
      requests += (s.match(/ http fetch /g) ?? []).length;
      err += s;
    });
    child.stdout.on('data', () => {});
    const code = await new Promise((r) => child.on('close', r));
    const c1 = cpu();
    return { code, ms: Math.round(performance.now() - t0), requests, err, cpuBusyPct: Math.round((100 * (c1.busy - c0.busy)) / (c1.total - c0.total)) };
  };
  if (mode === 'probe') {
    const sh = (c) => { try { return execFileSync('sh', ['-c', c], { encoding: 'utf8' }).trim(); } catch (e) { return `ERR ${String(e.message).slice(0, 200)}`; } };
    const small = (d) => sh(`mkdir -p ${d}/f && cd ${d}/f && s=$(date +%s%N) && for i in $(seq 1 3000); do echo x > f$i; done && e=$(date +%s%N) && echo $(( (e-s)/1000000 ))ms`);
    const out = {
      df: sh('df -h /tmp /dev/shm /'),
      mounts: sh('mount | grep -E " / | /tmp | /dev/shm " | head'),
      tmpfsMount: sh('mkdir -p /mnt/ram && mount -t tmpfs -o size=2g tmpfs /mnt/ram && echo mounted'),
      small3000_tmp: small('/tmp/probe'),
      small3000_shm: small('/dev/shm/probe'),
      small3000_ram: small('/mnt/ram/probe'),
    };
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(out));
  }
  const first = await ci([...(registry ? ['--registry', registry] : []), ...(args ?? [])]);
  const extra = {};
  if (mode === 'floor') {
    // Same container: (a) npm ci again with the npm cache now warm and no network (the floor for
    // extraction and linking), (b) restore a pre-built tarball of node_modules.
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
    const off = await ci(['--offline']);
    extra.offline = { code: off.code, ms: off.ms };
    execFileSync('tar', ['czf', join(dir, 'nm.tgz'), '-C', dir, 'node_modules']);
    extra.tarMiB = +(statSync(join(dir, 'nm.tgz')).size / 1048576).toFixed(1);
    rmSync(join(dir, 'node_modules'), { recursive: true, force: true });
    const t1 = performance.now();
    execFileSync('tar', ['xzf', join(dir, 'nm.tgz'), '-C', dir]);
    extra.tarExtractMs = Math.round(performance.now() - t1);
    extra.cpus = (await import('node:os')).cpus().length;
  }
  const { code, ms, requests, err, cpuBusyPct } = first;
  let installed = 0;
  try { installed = readdirSync(join(dir, 'node_modules')).length; } catch {}
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ...extra, cpuBusyPct, code, ms, httpFetches: requests, topLevelModules: installed, tail: err.split('\n').slice(-6).join('\n') }));
});
server.listen(8080);
