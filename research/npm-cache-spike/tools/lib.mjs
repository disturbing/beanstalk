// Client helpers: base URL from SPIKE_URL, bearer token from the file named by SPIKE_TOKEN_FILE.
import { readFileSync } from 'node:fs';

export const BASE = process.env.SPIKE_URL ?? 'https://beanstalk-npm-spike.devaccounts-1password.workers.dev';
const token = readFileSync(process.env.SPIKE_TOKEN_FILE, 'utf8').trim();

export async function call(path, body, attempt = 1) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    signal: AbortSignal.timeout(150000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  } catch (err) {
    if (attempt >= 3) throw err;
    return call(path, body, attempt + 1);
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
export const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
};
