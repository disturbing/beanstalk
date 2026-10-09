// Throwaway job server for the dependency-restore spike.
//   POST /job   {cmd}          -> {id}   runs `bash -c cmd` in the background, output to files
//   GET  /job/<id>             -> {done, code, ms, out, err} (last 64 KiB of each stream)
//   POST /write {path, b64}    -> writes a file (to update a tool without rebuilding the image)
//   GET  /health
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname } from 'node:path';

const JOBS = '/spike/jobs';
mkdirSync(JOBS, { recursive: true });
const jobs = new Map();
let next = 1;

function tail(path, max = 65536) {
  if (!existsSync(path)) return '';
  const size = statSync(path).size;
  const len = Math.min(size, max);
  const buf = Buffer.alloc(len);
  const fd = openSync(path, 'r');
  readSync(fd, buf, 0, len, size - len);
  closeSync(fd);
  return buf.toString('utf8');
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

const server = createServer(async (req, res) => {
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.url === '/health') return send(200, { ok: true });
    if (req.url === '/job' && req.method === 'POST') {
      const { cmd } = await body(req);
      const id = String(next++);
      const out = `${JOBS}/${id}.out`;
      const err = `${JOBS}/${id}.err`;
      const t0 = performance.now();
      const child = spawn('bash', ['-c', cmd], {
        stdio: ['ignore', openSync(out, 'w'), openSync(err, 'w')],
        env: { ...process.env, CI: '1' },
      });
      const job = { done: false, code: null, ms: null };
      jobs.set(id, job);
      child.on('close', (code) => {
        job.done = true;
        job.code = code;
        job.ms = Math.round(performance.now() - t0);
      });
      return send(200, { id });
    }
    const m = /^\/job\/(\d+)$/.exec(req.url ?? '');
    if (m && req.method === 'GET') {
      const job = jobs.get(m[1]);
      if (!job) return send(404, { error: 'no such job' });
      return send(200, { ...job, out: tail(`${JOBS}/${m[1]}.out`), err: tail(`${JOBS}/${m[1]}.err`, 16384) });
    }
    if (req.url === '/write' && req.method === 'POST') {
      const { path, b64, mode } = await body(req);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, Buffer.from(b64, 'base64'), { mode: mode ?? 0o755 });
      return send(200, { ok: true, bytes: readFileSync(path).length });
    }
    return send(404, { error: 'not found' });
  } catch (err) {
    return send(500, { error: String(err) });
  }
});
server.listen(8080);
