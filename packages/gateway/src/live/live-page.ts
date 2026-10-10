import type { RunId } from '@gitstalk/shared-race/ids';

/**
 * The live race page: lanes (agent slots), the sprout and the stalk, beans in flight,
 * decision cards, CI, cost and the event tail. It reads `?key=` (the run's view token) from
 * its own URL and follows the run over the WebSocket feed, falling back to polling
 * `GET /v1/runs/:run`. All data is rendered with `textContent`, never as HTML.
 */
export function livePage(run: RunId): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Race ${run}</title>
<style>
:root { --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6a66; --line: #e3e0d8; --busy: #2f7d4f; --blocked: #b7791f; --idle: #9a9893; --red: #b3261e; --green: #2f7d4f; }
@media (prefers-color-scheme: dark) { :root { --bg: #171716; --fg: #ecebe6; --muted: #9a9893; --line: #2c2b29; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
h1 { font-size: 18px; margin: 0 0 4px; } h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 18px 0 6px; }
.meta { color: var(--muted); } .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); }
table { border-collapse: collapse; width: 100%; } td, th { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--line); font-variant-numeric: tabular-nums; }
.chip { display: inline-block; padding: 1px 6px; margin: 2px; border-radius: 10px; border: 1px solid var(--line); font-size: 12px; }
.busy { color: var(--busy); } .blocked { color: var(--blocked); } .idle { color: var(--idle); } .green { color: var(--green); } .dropped, .red { color: var(--red); }
.bar { height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; } .bar > div { height: 100%; background: var(--busy); }
#log { font: 12px/1.35 ui-monospace, monospace; max-height: 360px; overflow: auto; border: 1px solid var(--line); padding: 6px; }
code { font: 12px ui-monospace, monospace; }
</style>
</head>
<body>
<h1>Race <code>${run}</code></h1>
<div class="meta" id="meta">connecting…</div>
<div class="grid">
  <section><h2>Lanes</h2><table><thead><tr><th>slot</th><th>state</th><th>work</th><th>invocation</th></tr></thead><tbody id="lanes"></tbody></table></section>
  <section><h2>Sprout and stalk</h2><div id="lines"></div><h2>Decisions</h2><div id="cards"></div><h2>CI</h2><div id="ci"></div></section>
  <section><h2>Cost</h2><div id="cost"></div><h2>Beans</h2><div id="beans"></div></section>
</div>
<h2>Events</h2><div id="log"></div>
<script>
(() => {
  const run = ${JSON.stringify(run)};
  const key = new URLSearchParams(location.search).get('key') || '';
  const $ = (id) => document.getElementById(id);
  const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (cls) node.className = cls; return node; };
  const short = (sha) => (typeof sha === 'string' ? sha.slice(0, 10) : '–');

  function render(view) {
    if (!view) return;
    $('meta').textContent = view.policy + ' · ' + view.agent + (view.model ? ' (' + view.model + ')' : '') + ' · ' + view.phase +
      (view.aborted ? ' · aborted: ' + view.aborted : '') + ' · t=' + view.t + 's · ' + view.events + ' events';
    const lanes = $('lanes'); lanes.replaceChildren();
    for (const slot of view.slots) {
      const row = el('tr');
      row.append(el('td', slot.slot), el('td', slot.activity + (slot.asking ? ' · polling' : ''), slot.activity), el('td', slot.holding || '–'), el('td', slot.invocation || '–'));
      lanes.append(row);
    }
    const policy = view.policy_state || {};
    const lines = $('lines'); lines.replaceChildren();
    const total = Object.keys(view.task_status).length;
    if (policy.sprout) {
      lines.append(el('div', 'sprout ' + short(policy.sprout.sha) + ' #' + policy.sprout.idx + ' · ' + policy.unvalidated + ' unvalidated' + (policy.validating.length ? ' · validating #' + policy.validating.join(' #') : '')));
      lines.append(el('div', 'stalk ' + short(policy.stalk.sha) + ' #' + policy.stalk.idx + ' · ' + view.tasks.green + ' / ' + total + ' beans green', 'green'));
      lines.append(el('div', 'turn: ' + (policy.turn || 'free') + (policy.waiting_for_turn.length ? ' (then ' + policy.waiting_for_turn.join(' ') + ')' : ''), 'meta'));
      for (const bean of policy.beans) lines.append(el('div', bean.task + ' on ' + bean.slot + ': ' + bean.step + (bean.rounds ? ' · round ' + bean.rounds : '') + (bean.rechecks ? ' · rechecks ' + bean.rechecks : '')));
      for (const ticket of policy.tickets) if (ticket.status !== 'closed') lines.append(el('div', ticket.ticket + ' ' + ticket.status + ' (red #' + ticket.red_idx + ': ' + ticket.failing.join(' ') + ')', 'red'));
    } else {
      lines.append(el('div', 'stalk ' + short(policy.stalk || view.base_sha) + ' · ' + view.tasks.green + ' / ' + total + ' beans green', 'green'));
      lines.append(el('div', 'queue: ' + ((policy.pending || []).join(' ') || 'empty')));
      for (const batch of policy.inflight || []) lines.append(el('div', batch.batch + (batch.speculative ? ' (speculative)' : '') + ': ' + batch.tasks.join(' ')));
      if (policy.bisecting) lines.append(el('div', 'bisecting ' + policy.bisecting, 'red'));
      if (policy.stats) lines.append(el('div', 'ejections: ' + policy.stats.ejections_conflict + ' conflict / ' + policy.stats.ejections_red + ' red', 'meta'));
    }
    const cards = $('cards'); cards.replaceChildren();
    for (const card of policy.cards || []) {
      cards.append(el('div', card.card + ': ' + card.task + ' vs ' + card.against.join(', ')));
      for (const [task, spec] of Object.entries(card.specs)) cards.append(el('div', '  ' + task + ': ' + spec, 'meta'));
      cards.append(el('div', '  answer: POST /v1/runs/' + run + '/decisions/' + card.card + ' {"winner": "<task>"}', 'meta'));
    }
    if (!cards.childNodes.length) cards.append(el('div', 'none open', 'meta'));
    const ci = $('ci'); ci.replaceChildren(el('div', view.ci.claimed + ' / ' + view.ci.slots + ' slots claimed, ' + view.ci.queued + ' queued'));
    for (const job of view.ci.running) ci.append(el('div', job.ci + ' ' + job.purpose + ' ' + short(job.sha) + ' (' + job.status + ')'));
    const cost = $('cost'); cost.replaceChildren();
    const share = Math.min(1, view.cost.committed_usd / view.cost.budget_usd);
    const bar = el('div', undefined, 'bar'); const fill = el('div'); fill.style.width = (share * 100).toFixed(1) + '%'; bar.append(fill);
    cost.append(el('div', '$' + view.cost.spent_usd.toFixed(2) + ' spent of $' + view.cost.budget_usd.toFixed(2)), bar);
    const beans = $('beans'); beans.replaceChildren();
    for (const [id, status] of Object.entries(view.task_status)) beans.append(el('span', id + ' ' + status, 'chip ' + status));
    if (view.final && view.final.phase === 'done') lines.append(el('div', 'final: ' + (view.final.correct ? 'correct' : 'not correct') + ', ' + view.final.tasks_accepted + ' accepted', view.final.correct ? 'green' : 'red'));
  }

  function log(events) {
    const box = $('log');
    for (const event of events) {
      const detail = [event.task, event.batch, event.ticket, event.card, event.inv, event.ci, event.reason, event.purpose].filter(Boolean).join(' ');
      box.append(el('div', event.t.toFixed(1).padStart(8) + '  ' + event.type + '  ' + detail));
    }
    while (box.childNodes.length > 500) box.removeChild(box.firstChild);
    box.scrollTop = box.scrollHeight;
  }

  async function poll() {
    const response = await fetch('/v1/runs/' + run + '?key=' + encodeURIComponent(key));
    if (response.ok) render(await response.json());
    setTimeout(poll, 3000);
  }

  function connect() {
    const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const socket = new WebSocket(scheme + location.host + '/v1/runs/' + run + '/live?key=' + encodeURIComponent(key));
    socket.onmessage = (message) => {
      const data = JSON.parse(message.data);
      render(data.view);
      if (data.events) log(data.events);
    };
    socket.onerror = () => { socket.close(); };
    socket.onclose = () => { $('meta').textContent += ' · live feed closed, polling'; poll(); };
  }

  fetch('/v1/runs/' + run + '/events?limit=200&key=' + encodeURIComponent(key))
    .then((response) => (response.ok ? response.json() : { events: [] }))
    .then((page) => log(page.events.slice(-200)))
    .finally(connect);
})();
</script>
</body>
</html>`;
}
