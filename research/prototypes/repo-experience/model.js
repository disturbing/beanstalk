/*
 * Code computes: everything the page shows is derived here from the recorded run
 * (events.jsonl, the line of landings, tasks). No picking happens in this file.
 */
(function () {
  const D = window.BEANSTALK_RUN;
  const events = D.events;
  const start = events.find((e) => e.type === 'race.start');
  const end = events.find((e) => e.type === 'race.end');
  const T0 = start.t;
  const TEND = end.t;

  const tasks = new Map(D.tasks.map((t) => [t.id, t]));
  const byTask = new Map();
  for (const e of events) {
    const ids = e.task ? [e.task] : e.type === 'green.promote' ? e.tasks : [];
    for (const id of ids) {
      if (!byTask.has(id)) byTask.set(id, []);
      byTask.get(id).push(e);
    }
  }

  const BED_ORDER = [
    'auth',
    'billing',
    'cart',
    'catalog',
    'db',
    'inventory',
    'lib',
    'notifications',
    'orders',
    'shipping',
    'users',
    'core',
  ];
  function bedOf(path) {
    const m = /^src\/([^/]+)\//.exec(path);
    return m && BED_ORDER.includes(m[1]) ? m[1] : 'core';
  }
  const isTest = (p) => /\.test\.ts$/.test(p);

  const promotes = events.filter((e) => e.type === 'green.promote');
  const validations = events.filter((e) => e.type === 'ci.end' && e.purpose === 'validate');
  const lands = new Map(events.filter((e) => e.type === 'land').map((e) => [e.task, e]));
  const drops = new Map(events.filter((e) => e.type === 'task.drop').map((e) => [e.task, e]));
  const starts = new Map(events.filter((e) => e.type === 'task.start').map((e) => [e.task, e]));

  const landings = D.line.map((c) => {
    const beds = {};
    for (const f of c.files) {
      const b = bedOf(f.path);
      beds[b] = beds[b] || { lines: 0, src: 0, test: 0 };
      const n = f.additions + f.deletions;
      beds[b].lines += n;
      beds[b][isTest(f.path) ? 'test' : 'src'] += n;
    }
    const promote = promotes.find((p) => p.trunk_idx >= c.idx);
    return {
      ...c,
      beds,
      agent: D.meta.per_task[c.task]?.agent,
      title: tasks.get(c.task)?.title || c.task,
      promotedT: promote ? promote.t : null,
    };
  });
  const landingOf = new Map(landings.map((l) => [l.task, l]));

  const clock = (t) => {
    const s = Math.max(0, Math.round(t - T0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  };
  const dur = (s) => {
    s = Math.round(s);
    if (s < 60) return s + ' s';
    const m = Math.floor(s / 60);
    return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  };

  function stalkIdxAt(T) {
    let idx = -1;
    for (const p of promotes) if (p.t <= T) idx = Math.max(idx, p.trunk_idx);
    return idx;
  }

  /** A bean's state at time T, as one of: queued, writing, checking, reworking, deciding, landed, stalk, dropped. */
  function stateAt(task, T) {
    const evs = byTask.get(task) || [];
    let state = 'queued';
    let agent = null;
    let detail = '';
    for (const e of evs) {
      if (e.t > T) break;
      switch (e.type) {
        case 'task.start':
          state = 'writing';
          agent = e.agent;
          break;
        case 'invocation.start':
          state = e.kind === 'rework' ? 'reworking' : 'writing';
          agent = e.agent || agent;
          break;
        case 'invocation.end':
          state = 'checking';
          detail = '';
          break;
        case 'merge.conflict':
          state = 'reworking';
          detail = 'conflict in ' + e.files.map((f) => f.split('/').pop()).join(', ');
          break;
        case 'rework.start':
          state = 'reworking';
          if (e.reason === 'preland-red') detail = 'pre-land check red';
          break;
        case 'decision.request':
          state = 'deciding';
          detail = 'decision ' + e.card;
          break;
        case 'land':
          state = 'landed';
          break;
        case 'task.drop':
          state = 'dropped';
          detail = e.reason;
          break;
      }
    }
    const l = landingOf.get(task);
    if (state === 'landed' && l && l.idx <= stalkIdxAt(T)) state = 'stalk';
    return { state, agent, detail };
  }

  /** The bean's own footprint so far: files of its latest head ≤ T, relative to its merge base. */
  function filesSoFar(task, T) {
    const attempts = (D.beanHeads[task]?.attempts || []).filter((a) => a.t <= T);
    return attempts.length ? attempts[attempts.length - 1].files : [];
  }

  /** Recent conflicts per bed in the last `win` seconds. */
  function conflictsNear(T, win = 45) {
    const beds = new Map();
    for (const e of events) {
      if (e.t > T) break;
      if (e.type === 'merge.conflict' && e.t > T - win)
        for (const f of e.files) beds.set(bedOf(f), (beds.get(bedOf(f)) || 0) + 1);
    }
    return beds;
  }

  function inflightAt(T) {
    const out = [];
    for (const [task, s] of starts) {
      if (s.t > T) continue;
      const st = stateAt(task, T);
      if (['landed', 'stalk', 'dropped'].includes(st.state)) continue;
      const predicted = (s.predicted || []).map((p) => bedOf(p + '/x'));
      const files = filesSoFar(task, T);
      const beds = new Set(files.map(bedOf));
      out.push({
        task,
        title: tasks.get(task).title,
        agent: st.agent,
        state: st.state,
        detail: st.detail,
        since: s.t,
        predicted,
        files,
        beds,
      });
    }
    return out.sort((a, b) =>
      (a.agent || '').localeCompare(b.agent || '', undefined, { numeric: true }),
    );
  }

  /** A bean's journey as plain steps. */
  function journey(task) {
    const evs = byTask.get(task) || [];
    const steps = [];
    const short = (p) => p.split('/').pop();
    for (const e of evs) {
      const s = { t: e.t, kind: 'step', text: '' };
      switch (e.type) {
        case 'footprint.predicted':
          s.text = `Footprint predicted in ${e.selected.map((p) => p.replace('src/', '')).join(', ')}`;
          s.kind = 'plan';
          break;
        case 'task.start':
          s.text = `${e.agent} picked it up`;
          s.kind = 'agent';
          break;
        case 'invocation.end': {
          s.kind = e.ok ? 'agent' : 'red';
          s.text = `${e.kind === 'rework' ? 'Reworked' : 'Wrote the change'} in ${e.num_turns} turns, ${dur(e.wall_ms / 1000)}, $${(e.cost_usd || 0).toFixed(2)}`;
          s.quote = e.result_text;
          break;
        }
        case 'task.commit':
          if (!e.new_commit) continue;
          s.text = `Committed ${e.files.length} file${e.files.length === 1 ? '' : 's'}: ${e.files.map(short).join(', ')}`;
          break;
        case 'preland.check':
          s.kind = e.green ? 'green' : 'red';
          s.text = e.green
            ? 'Pre-land check passed on the merged tree'
            : `Pre-land check red: ${(e.failing_files || []).map(short).join(', ') || 'failing tests'}`;
          break;
        case 'preland.optimistic':
          s.text = `Landed without a re-check: ${e.landed_meanwhile} beans landed meanwhile, none on its files`;
          break;
        case 'preland.recheck':
          s.text = 'The sprout moved under it, so it was checked again';
          break;
        case 'merge.conflict':
          s.kind = 'red';
          s.text = `Conflicted with the sprout in ${e.files.map(short).join(', ')}`;
          break;
        case 'rework.start':
          s.kind = 'rework';
          s.text = `Sent back to its author (${e.reason === 'preland-red' ? 'red check' : e.reason}, attempt ${e.attempt})`;
          break;
        case 'land':
          s.kind = 'land';
          s.text = `Landed on the sprout as #${e.trunk_idx}`;
          break;
        case 'green.promote': {
          const l = landingOf.get(task);
          if (!l || e.trunk_idx < l.idx || steps.some((x) => x.kind === 'stalk')) continue;
          s.kind = 'stalk';
          s.text = `Validated and promoted to the stalk with ${e.tasks.length - 1 ? e.tasks.length - 1 + ' others' : 'nothing else'}`;
          break;
        }
        case 'task.drop':
          s.kind = 'red';
          s.text = 'Fell off: ' + e.reason.replace('--max-rework', 'the maximum');
          break;
        case 'decision.request':
          s.kind = 'decide';
          s.text = `Decision ${e.card} opened: its spec disagrees with ${e.against.join(', ')}`;
          break;
        case 'decision.made':
          s.kind = 'decide';
          s.text = `${e.card} decided for ${e.winner} (${e.oracle === 'landed' ? 'keep what landed' : e.oracle}) after ${e.wait_seconds} s`;
          break;
        case 'ticket.culprit':
          s.kind = 'red';
          s.text = `Named as the cause of red validation ${e.ticket}`;
          break;
        case 'revert.conflict':
          s.kind = 'red';
          s.text = `Its revert conflicted in ${e.files.map(short).join(', ')}`;
          break;
        case 'acceptance.restored':
          s.text = 'Its agent edited an acceptance test; the original was restored';
          break;
        default:
          continue;
      }
      steps.push(s);
    }
    // green.promote events are listed under every promoted task; include the first that covers this landing.
    const l = landingOf.get(task);
    if (l && !steps.some((x) => x.kind === 'stalk')) {
      const p = promotes.find((p) => p.trunk_idx >= l.idx);
      if (p) steps.push({ t: p.t, kind: 'stalk', text: 'Validated and promoted to the stalk' });
    }
    return steps.sort((a, b) => a.t - b.t);
  }

  const decisions = events
    .filter((e) => e.type === 'decision.request')
    .map((r) => ({
      ...r,
      made: events.find((m) => m.type === 'decision.made' && m.card === r.card),
    }));

  const tickets = events
    .filter((e) => e.type === 'ticket.open')
    .map((o) => {
      const culprit = events.find((e) => e.type === 'ticket.culprit' && e.ticket === o.ticket);
      const greenAgain = validations.find((v) => v.t > o.t && v.green);
      const inherited = events.filter(
        (e) =>
          e.type === 'rework.start' &&
          e.reason === 'preland-red' &&
          e.t >= o.t &&
          (!greenAgain || e.t <= greenAgain.t),
      ).length;
      return {
        ...o,
        culprit,
        greenAgain,
        inherited,
        revertConflict: events.find((e) => e.type === 'revert.conflict' && e.ticket === o.ticket),
      };
    });

  /** Every file at the end of the run, plus the paths only dropped beans created. */
  const filePaths = Object.keys(D.files);

  function grepCount(path, term) {
    const c = D.files[path]?.content || '';
    const m = c.toLowerCase().split(term.toLowerCase()).length - 1;
    return m;
  }

  window.M = {
    D,
    T0,
    TEND,
    tasks,
    byTask,
    landings,
    landingOf,
    lands,
    drops,
    starts,
    promotes,
    validations,
    decisions,
    tickets,
    BED_ORDER,
    bedOf,
    isTest,
    clock,
    dur,
    stalkIdxAt,
    stateAt,
    inflightAt,
    journey,
    conflictsNear,
    filePaths,
    grepCount,
  };
})();
