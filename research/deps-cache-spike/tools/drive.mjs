// Local driver for the spike Worker. Token from the file named by SPIKE_TOKEN_FILE.
//   node drive.mjs push <instance>             copy image/tools/* into the container's /spike
//   node drive.mjs run <instance> <cmd> [sec]  run a shell command there, wait, print the output
//   node drive.mjs get <path>                  GET a control path (/list?prefix=, /whoami)
//   node drive.mjs post <path>                 POST a control path (/purge, /destroy/<i>)
// Results worth keeping are appended to ../results/runs.jsonl by `run` when RECORD=<label>.
import { appendFileSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SPIKE_URL ?? 'https://beanstalk-deps-spike.devaccounts-1password.workers.dev';
const token = readFileSync(process.env.SPIKE_TOKEN_FILE, 'utf8').trim();
const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

async function call(path, method = 'GET', body) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
      const text = await res.text();
      if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 400)}`);
      return { json: JSON.parse(text), colo: res.headers.get('x-colo') };
    } catch (err) {
      if (attempt >= 5) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

const [cmd, a, b, c] = process.argv.slice(2);
if (cmd === 'push') {
  const dir = join(here, '../image/tools');
  for (const f of readdirSync(dir)) {
    const b64 = readFileSync(join(dir, f)).toString('base64');
    const { json } = await call(`/c/${a}/write`, 'POST', { path: `/spike/${f}`, b64 });
    console.log(f, json.bytes);
  }
} else if (cmd === 'run') {
  const t0 = Date.now();
  const { json: started, colo } = await call(`/c/${a}/job`, 'POST', { cmd: b });
  const deadline = Date.now() + Number(c ?? 1800) * 1000;
  let job;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    job = (await call(`/c/${a}/job/${started.id}`)).json;
    if (job.done || Date.now() > deadline) break;
  }
  const record = { at: new Date().toISOString(), instance: a, colo, cmd: b, code: job.code, ms: job.ms, wallMs: Date.now() - t0, out: job.out, err: job.err };
  if (process.env.RECORD) appendFileSync(join(here, '../results/runs.jsonl'), `${JSON.stringify({ label: process.env.RECORD, ...record })}\n`);
  console.log(`[code ${job.code} ms ${job.ms} colo ${colo}]`);
  process.stdout.write(job.out);
  if (job.err) process.stdout.write(`--- stderr ---\n${job.err.slice(-4000)}`);
} else if (cmd === 'get' || cmd === 'post') {
  console.log(JSON.stringify((await call(a, cmd.toUpperCase())).json, null, 1));
}
