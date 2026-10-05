/*
 * The controller: the compressed stalk on the left (beans at the tip, young sprout leaves,
 * mature stalk leaves, red marks, beans that fell off), the scrubber, and the explorer on
 * the right. State lives in the URL: ?t=<seconds>|end, ?q=<question>, ?bean=<id>, ?theme=dark.
 */
(function () {
  const { esc, plural } = K;
  const { T0, TEND, landings, drops, tasks, tickets, stalkIdxAt, inflightAt, clock } = M;
  const params = new URLSearchParams(location.search);
  const S = {
    T: K.moment(760),
    q: params.get('q') || '',
    bean: params.get('bean'),
    playing: false,
  };

  document.getElementById('head').innerHTML = K.repoHead('code', { T: S.T });
  // keyboard hints on the tabs (shown by the Nightshift skin)
  const KEYS = ['g c', 'g b', 'g s', 'g d', 'g k', 'g i'];
  document.querySelectorAll('.tab').forEach((tab, i) => tab.insertAdjacentHTML('beforeend', `<kbd class="kh">${KEYS[i] || ''}</kbd>`));
  const stalkEl = document.getElementById('stalk');
  const col = document.querySelector('.stalkcol');
  const range = document.getElementById('range');
  let firstPaint = true;

  function render() {
    const plan = Explorer.plan(S);
    document.getElementById('explorer').innerHTML = plan.html;
    renderStalk(plan.relevant);
    range.value = Math.round(((S.T - T0) / (TEND - T0)) * 1000);
    document.getElementById('clock').textContent = `${clock(S.T)} of ${clock(TEND)}`;
    statusLine();
    syncUrl();
  }

  /** The editor-style status line: the lines, the swarm and the run clock. */
  function statusLine() {
    const el = document.getElementById('status');
    if (!el) return;
    const landed = landings.filter((l) => l.t <= S.T).length;
    const s = stalkIdxAt(S.T);
    const flying = inflightAt(S.T);
    const agents = new Set(flying.map((b) => b.agent)).size;
    const red = M.validations.some((v) => !v.green && v.t <= S.T && !M.validations.some((g) => g.green && g.t > v.t && g.t <= S.T));
    el.innerHTML = `<span class="sl-item"><i class="sl-dot sprout"></i>sprout #${landed - 1}</span><span class="sl-item"><i class="sl-dot stalk"></i>stalk #${s}</span>
      <span class="sl-item ${red ? 'sl-red' : ''}">${red ? 'sprout red' : 'sprout green'}</span><span class="sl-item"><i class="sl-dot bean"></i>${plural(flying.length, 'bean')} growing</span>
      <span class="sl-item">${agents}/12 agents busy</span><span class="sl-sp"></span><span class="sl-item">run 7z4j84eqvl</span><span class="sl-item sl-clock">${clock(S.T)}</span>`;
  }

  /* ---------- The stalk, reconciled by key so new leaves grow and old ones change colour ---------- */
  function desiredRows(relevant) {
    const rows = [];
    const flying = inflightAt(S.T);
    const stalkIdx = stalkIdxAt(S.T);
    const hit = (task) => (relevant && relevant.has(task) ? ' hit' : '');
    const culprits = new Set(tickets.filter((k) => k.culprit && k.culprit.t <= S.T).map((k) => k.culprit.task));
    if (flying.length) {
      for (const b of flying) {
        rows.push({ key: `b-${b.task}`, cls: `srow bean ${b.state}${hit(b.task)}${S.bean === b.task ? ' sel' : ''}`, task: b.task,
          html: `<span class="ag">${b.agent}</span><span class="stem"><i class="beanmark"></i></span><span class="tt">${esc(b.title)} <span class="st">${b.state}</span></span><span class="ix"></span>` });
      }
    } else {
      rows.push({ key: 'idle', cls: 'tipnote', html: `<span></span><span class="sp"><svg width="18" height="18" viewBox="0 0 16 16"><path d="M8 15V8" stroke="#7cb518" stroke-width="1.6"/><path d="M8 9c0-2.5 2-4.5 5-4.5 0 2.5-2 4.5-5 4.5Z" fill="#7cb518"/></svg></span><span>${S.T >= TEND ? 'Nothing growing. The run is finished.' : 'Nothing growing right now.'}</span>` });
    }
    const items = [
      ...landings.filter((l) => l.t <= S.T).map((l) => ({ t: l.t, l })),
      ...[...drops.values()].filter((d) => d.t <= S.T).map((d) => ({ t: d.t, d })),
    ].sort((a, b) => b.t - a.t);
    const newest = items.find((i) => i.l)?.l.idx ?? -1;
    let pointer = false, first = true;
    const FOLD_OVER = 60, KEEP = 30;
    const landedCount = items.filter((i) => i.l).length;
    const folds = new Map();
    if (landedCount > FOLD_OVER) {
      const keepIdx = items.filter((i) => i.l)[KEEP - 1].l.idx;
      for (const it of items) if (it.l && it.l.idx < keepIdx && it.l.idx <= stalkIdx) {
        const p = M.promotes.find((x) => x.trunk_idx >= it.l.idx);
        if (p) { folds.set(it.l.task, p); }
      }
    }
    const shownFold = new Set();
    for (const it of items) {
      if (it.l && folds.has(it.l.task)) {
        const p = folds.get(it.l.task);
        if (!shownFold.has(p)) {
          shownFold.add(p);
          const n = [...folds.values()].filter((x) => x === p).length;
          rows.push({ key: `f-${p.trunk_idx}`, cls: 'pointer fold', html: `<span></span><span class="stem"></span><span>validated at ${clock(p.t)}: ${plural(n, 'bean')}</span>` });
        }
        continue;
      }
      if (it.d) {
        rows.push({ key: `d-${it.d.task}`, cls: `srow fell${hit(it.d.task)}${S.bean === it.d.task ? ' sel' : ''}`, task: it.d.task,
          html: `<span class="tm">${clock(it.t)}</span><span class="stem"><i class="fl"></i></span><span class="tt" title="Fell off: ${esc(it.d.reason)}">${esc(tasks.get(it.d.task).title)}</span><span class="ix">fell</span>` });
        continue;
      }
      const l = it.l;
      if (!pointer && l.idx <= stalkIdx && newest > stalkIdx) {
        rows.push({ key: 'ptr', cls: 'pointer', html: `<span></span><span class="stem"></span><span>stalk at #${stalkIdx}, ${newest - stalkIdx} on the sprout above</span>` });
        pointer = true;
      }
      const state = culprits.has(l.task) ? 'red' : l.idx <= stalkIdx ? 'stalk' : 'sprout';
      rows.push({ key: `l-${l.task}`, task: l.task,
        cls: `srow ${state === 'stalk' ? '' : state}${l.idx % 2 ? ' l' : ''}${first && !flying.length ? ' first' : ''}${hit(l.task)}${S.bean === l.task ? ' sel' : ''}`,
        html: `<span class="tm">${clock(l.t)}</span><span class="stem"><i class="lf"></i></span><span class="tt" title="${esc(l.title)}">${esc(l.title)}</span><span class="ix">#${l.idx}</span>` });
      first = false;
    }
    rows.push({ key: 'seed', cls: 'seedrow', html: `<span></span><span class="stem"></span><span>Fertilized by <b>coop</b> <span class="mono muted" title="base commit">${M.D.meta.base.slice(0, 7)}</span></span>` });
    return rows;
  }

  function renderStalk(relevant) {
    col.classList.toggle('asking', Boolean(relevant));
    // a validation in the last few seconds sends a pulse up the filament
    col.classList.toggle('validating', M.promotes.some((p) => p.t <= S.T && p.t > S.T - 6));
    const rows = desiredRows(relevant);
    const existing = new Map([...stalkEl.children].map((el) => [el.dataset.key, el]));
    const keep = new Set();
    for (const row of rows) {
      let el = existing.get(row.key);
      const isNew = !el;
      if (isNew) {
        el = document.createElement('div');
        el.dataset.key = row.key;
      }
      if (el.dataset.html !== row.html) { el.innerHTML = row.html; el.dataset.html = row.html; }
      el.className = row.cls + (isNew && !firstPaint && row.key.startsWith('l-') ? ' enter' : '');
      if (row.task) el.dataset.bean = row.task; else delete el.dataset.bean;
      stalkEl.appendChild(el);
      keep.add(row.key);
    }
    for (const [key, el] of existing) if (!keep.has(key)) el.remove();
    document.getElementById('stalkSummary').textContent = `${plural(landings.filter((l) => l.t <= S.T).length, 'bean')} landed, ${inflightAt(S.T).length} growing`;
    firstPaint = false;
  }

  /* ---------- Time ---------- */
  let last = 0, explorerTimer = 0;
  function tick(now) {
    if (!S.playing) return;
    const dt = last ? (now - last) / 1000 : 0;
    last = now;
    S.T = Math.min(TEND, S.T + dt * 25);
    renderStalk(Explorer.plan(S).relevant);
    range.value = Math.round(((S.T - T0) / (TEND - T0)) * 1000);
    document.getElementById('clock').textContent = `${clock(S.T)} of ${clock(TEND)}`;
    clearTimeout(explorerTimer);
    explorerTimer = setTimeout(() => (document.getElementById('explorer').innerHTML = Explorer.plan(S).html), 300);
    if (S.T >= TEND) return setPlaying(false);
    requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    S.playing = on;
    document.getElementById('play').textContent = on ? '❚❚' : '▶';
    if (on) { if (S.T >= TEND) S.T = T0; last = 0; requestAnimationFrame(tick); } else render();
  }

  function syncUrl() {
    const p = new URLSearchParams();
    p.set('t', S.T >= TEND ? 'end' : String(Math.round(S.T - T0)));
    if (S.q) p.set('q', S.q);
    if (S.bean) p.set('bean', S.bean);
    if (params.get('theme')) p.set('theme', params.get('theme'));
    if (params.get('skin')) p.set('skin', params.get('skin'));
    if (params.get('day')) p.set('day', params.get('day'));
    history.replaceState(null, '', `?${p}`);
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', (e) => {
    const clear = e.target.closest('[data-clear]');
    if (clear) { e.preventDefault(); S.q = ''; S.bean = null; return render(); }
    const jump = e.target.closest('[data-t]');
    if (jump) { e.preventDefault(); S.T = T0 + Number(jump.dataset.t); return render(); }
    const ask = e.target.closest('[data-ask]');
    if (ask) { e.preventDefault(); S.q = ask.dataset.ask; S.bean = null; return render(); }
    const bean = e.target.closest('[data-bean]');
    if (bean) { e.preventDefault(); S.bean = bean.dataset.bean; return render(); }
  });
  document.addEventListener('submit', (e) => {
    if (e.target.id !== 'askForm') return;
    e.preventDefault();
    S.q = new FormData(e.target).get('q').trim();
    S.bean = null;
    render();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); document.querySelector('#askForm input')?.focus(); }
  });
  range.addEventListener('input', () => { S.playing = false; S.T = T0 + (range.value / 1000) * (TEND - T0); render(); });
  document.getElementById('play').addEventListener('click', () => setPlaying(!S.playing));

  render();
  if (params.get('play')) setPlaying(true);
})();
