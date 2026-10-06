import { readFileSync, appendFileSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import path from 'node:path';

const runtime = '/private/tmp/beanstalk-three-agent-trial';
const before = JSON.parse(readFileSync(path.join(runtime, 'ready.json'), 'utf8'));
try { process.kill(before.pid, 'SIGTERM'); }
catch (error) { if (error.code !== 'ESRCH') throw error; }
let closed = false;
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await fetch(before.origin, { signal: AbortSignal.timeout(500) }); }
  catch { closed = true; break; }
  await setTimeout(100);
}
if (!closed) throw new Error('Previous trial service did not close');
const log = openSync(path.join(runtime, 'server.log'), 'a', 0o600);
const child = spawn(process.execPath, [path.join(runtime, 'server.mjs')], {
  detached: true, stdio: ['ignore', log, log], cwd: '/Users/coop/Workspace/beanstalk',
});
child.unref();
closeSync(log);
let after;
for (let attempt = 0; attempt < 100; attempt += 1) {
  await setTimeout(100);
  const current = JSON.parse(readFileSync(path.join(runtime, 'ready.json'), 'utf8'));
  if (current.pid !== before.pid) {
    try { await fetch(current.origin, { signal: AbortSignal.timeout(500) }); after = current; break; }
    catch { /* Keep waiting for the local service to listen. */ }
  }
}
if (after === undefined) throw new Error('Restarted trial service did not become ready');
if (after.run !== before.run) throw new Error('Restart changed the canonical run');
const evidence = { at: new Date().toISOString(), action: 'restart', run: after.run,
  previous_pid: before.pid, current_pid: after.pid, sqlite_preserved: true };
appendFileSync(path.join(runtime, 'evidence', 'lifecycle.jsonl'), `${JSON.stringify(evidence)}\n`);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
