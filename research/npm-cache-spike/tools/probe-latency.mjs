// Wall time of one small /bench read call from this machine (diagnoses harness slowness).
import { call } from './lib.mjs';

for (let i = 0; i < 3; i++) {
  const t = Date.now();
  const r = await call('/bench', { op: 'read', layer: 'r2', paths: ['/ms/-/ms-2.1.3.tgz', '/debug/-/debug-4.4.3.tgz'], e: 'dbg' });
  console.log(Date.now() - t, 'ms wall', JSON.stringify(r.rows.map((x) => Math.round(x.ms))), r.colo);
}
