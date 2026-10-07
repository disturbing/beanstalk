#!/usr/bin/env node
// The admin read of product analytics (docs/claude-opus/19-accounts-and-auth.md §10): how
// many sign-ups, agent connections, repositories created and beans pushed, and how many
// distinct people did each, from the Analytics Engine dataset the Workers write to.
//
//   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… pnpm product-events [--days 30] [--dataset product_events]
//
// The token needs "Account Analytics: Read". Nothing is written; the token is never printed.
import { parseArgs } from 'node:util';

const EVENTS = ['signup', 'connect', 'repo_create', 'bean_push'];

const { values } = parseArgs({
  options: {
    days: { type: 'string', default: '30' },
    dataset: { type: 'string', default: 'product_events' },
  },
});

const days = Number(values.days);
if (!Number.isInteger(days) || days < 1 || days > 90) fail('--days must be a whole number, 1–90');
// The dataset name goes into the SQL text, so only a plain identifier is accepted.
if (!/^[a-z][a-z0-9_]{0,63}$/.test(values.dataset)) fail('--dataset must be a plain identifier');
const account = process.env.CLOUDFLARE_ACCOUNT_ID ?? '';
const token = process.env.CLOUDFLARE_API_TOKEN ?? '';
if (account === '' || token === '') fail('set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN');

const sql = `SELECT blob1 AS event, SUM(_sample_interval) AS events, COUNT(DISTINCT blob2) AS people
FROM ${values.dataset}
WHERE timestamp > NOW() - INTERVAL '${days}' DAY
GROUP BY event
FORMAT JSON`;

const response = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`,
  {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: sql,
    signal: AbortSignal.timeout(20_000),
  },
);
const text = await response.text();
if (!response.ok) fail(`Analytics Engine answered ${response.status}: ${text.slice(0, 300)}`);
const rows = new Map(
  JSON.parse(text).data.map((row) => [
    row.event,
    { events: Number(row.events), people: Number(row.people) },
  ]),
);

console.log(`${values.dataset}, last ${days} days (events are sample-weighted)`);
console.log('event        events  people');
for (const event of EVENTS) {
  const row = rows.get(event) ?? { events: 0, people: 0 };
  console.log(
    `${event.padEnd(12)} ${String(row.events).padStart(6)}  ${String(row.people).padStart(6)}`,
  );
}

function fail(message) {
  console.error(`product-events: ${message}`);
  process.exit(1);
}
