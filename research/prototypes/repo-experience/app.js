/*
 * The plot: one view of the repository where time runs up the stalk and the code runs across.
 * Code computes (model.js), the picker picks (jev.js), this file only renders fixed parts.
 */
(function () {
  const {
    D,
    T0,
    TEND,
    tasks,
    landings,
    landingOf,
    drops,
    decisions,
    tickets,
    BED_ORDER,
    bedOf,
    isTest,
    clock,
    dur,
  } = M;
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s ?? '').replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
    );
  const short = (p) => p.split('/').pop();
  const plural = (n, w, ws) => `${n} ${n === 1 ? w : ws || w + 's'}`;
  const BEAN_SVG =
    '<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="M5 2.5c3-1.5 8 1 8.5 5 .5 4-3.5 7-7 6S1 9 2.5 6c.6-1.3 1.3-2.8 2.5-3.5Z"/></svg>';

  const S = {
    T: TEND,
    focus: null, // { cls, label, files:Set, beans:Set, receipts:{} , sentence, sections:[] }
    view: { kind: 'overview' },
    playing: false,
    cache: new Map(), // decision key -> receipt (so scrubbing does not re-ask)
  };

  /* ---------- Picks ---------- */
  async function decideOnce(key, decision) {
    if (S.cache.has(key)) return S.cache.get(key);
    const r = await Picker.decide(decision);
    S.cache.set(key, r);
    return r;
  }
  const pickTag = (r, label = 'picked') =>
    r
      ? `<button class="pick" data-receipt="${r.n}" type="button" title="See what was picked and why">${BEAN_SVG}${esc(label)}</button>`
      : '';

  function updatePicksButton() {
    $('#picksCount').textContent = plural(Picker.receipts.length, 'pick');
    $('#pickerMode').textContent = Picker.status.by === 'jev' ? 'Jev live' : 'Rules (Jev offline)';
  }
  Picker.onReceipt(updatePicksButton);

  function receiptHTML(r) {
    const order = new Map(r.chosen.map((id, i) => [id, i + 1]));
    const cands = r.candidates
      .map(
        (c) =>
          `<li class="${order.has(c.id) ? 'on' : ''}"><b>${order.get(c.id) || ''}</b><span>${esc(c.label || c.desc)}</span></li>`,
      )
      .join('');
    const by =
      r.by === 'jev'
        ? `Jev picked${r.confidence != null ? `, confidence ${r.confidence.toFixed(2)}` : ''}, ${r.ms} ms.`
        : `Rules picked because Jev is offline. ${esc(r.why)}`;
    return `<h4>${esc(r.title)}</h4><p class="q">${esc(r.ask)}</p>
      <ul class="cands">${cands}</ul>
      <p class="by">${by}<br>Jev would see ${r.stateBytes.toLocaleString()} bytes: the question and these descriptions, never file contents.</p>`;
  }

  function openPopover(btn) {
    const r = Picker.receipts[Number(btn.dataset.receipt) - 1];
    if (!r) return;
    const pop = $('#popover');
    pop.innerHTML = receiptHTML(r);
    pop.hidden = false;
    const b = btn.getBoundingClientRect();
    const w = pop.offsetWidth,
      h = pop.offsetHeight;
    pop.style.left = Math.max(12, Math.min(innerWidth - w - 12, b.left - 20)) + 'px';
    pop.style.top =
      (b.bottom + h + 8 < innerHeight ? b.bottom + 8 : Math.max(12, b.top - h - 8)) + 'px';
  }

  function openDrawer() {
    const d = $('#drawer');
    d.innerHTML = `<button class="close" type="button" data-close>Close</button>
      <h3 style="font:500 24px/1.2 var(--serif);margin:0 0 6px">Every pick on this page</h3>
      <div class="status">${esc(Picker.status.note)}</div>
      <p class="prose small">Code computes each candidate list from the run; the picker only chooses among them. Nothing here writes layout.</p>
      ${Picker.receipts
        .slice()
        .reverse()
        .map((r) => `<div class="rc">${receiptHTML(r)}</div>`)
        .join('')}`;
    d.hidden = false;
  }

  /* ---------- Time ---------- */
  const landedBy = (T) => landings.filter((l) => l.t <= T).sort((a, b) => b.idx - a.idx);
  function redAt(T) {
    const t = tickets.find((k) => k.t <= T && (!k.greenAgain || k.greenAgain.t > T));
    return t || null;
  }
  function busiestMoment() {
    let best = { n: 0, T: TEND };
    for (let T = T0 + 60; T < TEND; T += 15) {
      const f = M.inflightAt(T);
      const beds = new Map();
      f.forEach((b) =>
        new Set([...b.beds, ...b.predicted]).forEach((x) => beds.set(x, (beds.get(x) || 0) + 1)),
      );
      const crowd = Math.max(0, ...beds.values());
      const score = f.length * 10 + crowd;
      if (score > best.n) best = { n: score, T };
    }
    return best.T;
  }

  /* ---------- Columns ---------- */
  function columns() {
    const f = S.focus;
    const cols = [];
    const narrow = innerWidth < 700;
    for (const bed of BED_ORDER) {
      const files = f
        ? [...f.files]
            .filter((p) => bedOf(p) === bed)
            .sort((a, b) => isTest(a) - isTest(b) || a.localeCompare(b))
        : [];
      const byBed = f && (f.byBed || f.files.size > 12);
      if (byBed) {
        const any = [...f.files].some((p) => bedOf(p) === bed);
        cols.push(f.byBed || any ? { kind: 'bed', bed, label: bed, w: narrow ? 22 : 40 } : { kind: 'collapsed', bed, label: bed, w: narrow ? 6 : 12 });
      } else if (f && files.length)
        files.forEach((p) =>
          cols.push({ kind: 'file', bed, path: p, label: short(p).replace(/\.ts$/, ''), w: 34 }),
        );
      else if (f) cols.push({ kind: 'collapsed', bed, label: bed, w: narrow ? 6 : 12 });
      else cols.push({ kind: 'bed', bed, label: bed, w: narrow ? 22 : 40 });
    }
    return cols;
  }
  const template = (cols) =>
    innerWidth < 700
      ? `38px 24px minmax(110px, 1fr) ${cols.map((c) => c.w + 'px').join(' ')}`
      : `52px 30px minmax(200px, 1fr) ${cols.map((c) => c.w + 'px').join(' ')}`;
  const colHas = (c, paths) =>
    c.kind === 'file' ? paths.includes(c.path) : paths.some((p) => bedOf(p) === c.bed);

  /* ---------- Plot ---------- */
  function renderPlot() {
    const T = S.T;
    const cols = columns();
    const plot = $('#plot');
    plot.style.setProperty('--cols', template(cols));
    plot.classList.toggle('tall', cols.some((c) => c.kind === 'file'));
    const stalkIdx = M.stalkIdxAt(T);
    const inflight = M.inflightAt(T);
    const conflicts = M.conflictsNear(T);
    const red = redAt(T);
    const culprit = tickets.find((k) => k.culprit && k.culprit.t <= T)?.culprit?.task;

    // Crowding per column: buds whose written or predicted footprint falls in it.
    const crowd = cols.map(
      (c) =>
        inflight.filter((b) =>
          c.kind === 'file'
            ? b.files.includes(c.path)
            : b.beds.has(c.bed) || b.predicted.includes(c.bed),
        ).length,
    );

    let html = `<div class="head"><div class="gutterh">${S.focus ? (S.focus.byBed ? 'Every area of the code. A violet dot is a bean in flight that has written there; a ring means two beans wrote the same file.' : 'Only the files this answer is about; the other areas fold away.') : 'Newest at the top. Each row is a bean that landed, each column an area of the code.'}</div>`;
    cols.forEach((c, i) => {
      const hot = c.kind !== 'file' && conflicts.has(c.bed);
      html += `<div class="bedh ${c.kind === 'file' ? 'fcol' : c.kind} ${c.path && isTest(c.path) ? 'test' : ''}" title="${esc(c.path || c.bed)}">
        <button type="button" data-col="${i}"><span>${esc(c.kind === 'collapsed' ? '' : c.label)}</span></button>
        ${crowd[i] && c.kind !== 'collapsed' ? `<b class="crowd ${hot ? 'hot' : ''}" title="${plural(crowd[i], 'bean')} in flight here">${crowd[i]}</b>` : ''}
      </div>`;
    });
    html += '</div>';

    // The growing tip: beans in flight.
    html += '<div class="tipzone">';
    if (inflight.length) {
      for (const b of inflight) {
        const isSel = S.view.kind === 'bean' && S.view.id === b.task;
        const cells = cols
          .map((c, i) => {
            const wrote = colHas(c, b.files);
            const plan = !wrote && c.kind !== 'file' && b.predicted.includes(c.bed);
            if (!wrote && !plan) return '';
            const overlap = b.files.some((p) => colHas(c, [p]) && inflight.some((o) => o !== b && o.files.includes(p)));
            const conflict = c.kind !== 'file' && conflicts.has(c.bed) && wrote;
            return `<div class="cell ${overlap ? 'overlap' : ''} ${conflict ? 'conflict' : ''}" style="grid-column:${i + 4}">${wrote ? '<i class="wrote"></i>' : '<i class="plan"></i>'}</div>`;
          })
          .join('');
        const stateWord =
          {
            writing: 'writing',
            checking: 'checking',
            reworking: 'reworking',
            deciding: 'waiting on a decision',
            queued: 'queued',
          }[b.state] || b.state;
        html += `<div class="row bud ${b.state} ${isSel ? 'sel' : ''}" data-bean="${b.task}" title="${esc(b.title)}">
          <div class="time"><span class="agent">${esc(b.agent || '')}</span></div>
          <div class="stalk"><i class="budmark"></i></div>
          <div class="title"><span class="state">${esc(stateWord)}</span><span class="t">${esc(b.title)}</span></div>
          ${cells}</div>`;
      }
    } else {
      html += `<div class="tipnote"><span>${T >= TEND ? `Nothing is growing: the run ended at ${clock(TEND)}. Press play to watch the swarm again.` : 'No beans in flight at this moment.'}</span></div>`;
    }
    html += '</div>';

    // The stalk: every landing up to T.
    let folded = [];
    const flush = () => {
      if (!folded.length) return;
      const sp = folded[0].idx > stalkIdx;
      html += `<div class="row fold ${sp ? 'sprout-only' : ''}"><div class="time"></div><div class="stalk"></div><div class="title"><span class="t">${plural(folded.length, 'other bean')}, folded</span></div></div>`;
      folded = [];
    };
    for (const l of landedBy(T)) {
      const paths = l.files.map((f) => f.path);
      const inBeans = !S.focus || S.focus.beans.has(l.task);
      const touches = S.focus && paths.some((p) => S.focus.files.has(p));
      if (S.focus && !inBeans && !touches) { folded.push(l); continue; }
      flush();
      const isMatch = inBeans;
      const sproutOnly = l.idx > stalkIdx;
      let last = -1;
      const cells = cols
        .map((c, i) => {
          const fs = l.files.filter((f) =>
            c.kind === 'file' ? f.path === c.path : bedOf(f.path) === c.bed,
          );
          if (!fs.length || c.kind === 'collapsed') return '';
          last = i;
          const n = fs.reduce((s, f) => s + f.additions + f.deletions, 0);
          const testOnly = fs.every((f) => isTest(f.path));
          const d = Math.max(6, Math.min(c.kind === 'file' ? 18 : 22, 4 + 2.1 * Math.sqrt(n)));
          return `<div class="cell" style="grid-column:${i + 4}" title="${esc(fs.map((f) => `${f.path} +${f.additions} −${f.deletions}`).join('\n'))}"><i class="dot ${testOnly ? 'test' : ''}" style="width:${d}px;height:${d}px"></i></div>`;
        })
        .join('');
      const vein =
        last >= 0
          ? `<div class="vein" style="grid-column:4 / ${last + 5};margin-right:${cols[last].w / 2}px"></div>`
          : '';
      const sel = S.view.kind === 'bean' && S.view.id === l.task;
      const cls = [
        'row',
        sproutOnly ? 'sprout-only' : '',
        culprit === l.task ? 'culprit' : '',
        S.focus ? (isMatch ? 'match' : 'faded') : '',
        sel ? 'sel' : '',
      ].join(' ');
      html += `<div class="${cls}" data-bean="${l.task}" title="${esc(l.title)}">
        <div class="time">${clock(l.t)}</div><div class="stalk"><i class="node"></i></div>
        <div class="title"><span class="t">${esc(l.title)}</span><span class="id">#${l.idx}</span></div>
        ${vein}${cells}</div>`;
    }
    flush();
    html += `<div class="seed"><div class="time">0:00</div><div class="stalk"></div><span>Base commit <span class="mono">${D.meta.base.slice(0, 7)}</span>, where the run began${red ? '' : ''}</span></div>`;
    plot.innerHTML = html;
    plot.dataset.cols = JSON.stringify(cols.map((c) => c.path || c.bed));
  }

  /* ---------- Lead (picked) ---------- */
  function leadCandidates(T) {
    const done = T >= TEND;
    const stalk = M.stalkIdxAt(T) + 1;
    const landed = landedBy(T).length;
    const inflight = M.inflightAt(T);
    const c = [];
    c.push({
      id: 'growth',
      label: 'How far the stalk has grown',
      desc: 'How many beans reached the stalk',
      text: done
        ? `${stalk} of ${tasks.size} changes reached the stalk in ${clock(TEND).replace(/(\d+):(\d+)/, (_, m, s) => `${m} minutes ${Number(s)} seconds`)}.`
        : `${stalk} of ${tasks.size} changes are on the stalk so far, ${landed - stalk} more on the sprout.`,
    });
    if (inflight.length) {
      const beds = new Map();
      inflight.forEach((b) =>
        new Set([...b.beds, ...b.predicted]).forEach((x) => beds.set(x, (beds.get(x) || 0) + 1)),
      );
      const [bed, n] = [...beds].sort((a, b) => b[1] - a[1])[0] || ['', 0];
      c.push({
        id: 'swarm',
        label: 'Where the swarm is working',
        desc: 'Agents working now and the busiest area',
        text: `${plural(inflight.length, 'agent')} are working right now; ${bed} is the busiest area with ${n} beans.`,
        act: { label: 'See the swarm', ask: 'where is the swarm working right now?' },
      });
    }
    const red = redAt(T);
    if (red)
      c.push({
        id: 'red',
        label: 'The sprout is red',
        desc: 'A validation is failing now',
        text: `The sprout is red: ${short(red.failing[0])} has failed since #${red.red_idx}.`,
        act: { label: 'What broke', ask: 'what broke the sprout?' },
      });
    const k = tickets.find((x) => x.greenAgain && x.greenAgain.t <= T);
    if (k)
      c.push({
        id: 'red-history',
        label: 'A red validation, traced and cleared',
        desc: 'Past red validation and its culprit',
        text: `One validation went red; read sets traced it to ${k.culprit?.task || 'a culprit'} and the sprout was green again ${dur(k.greenAgain.t - k.t)} later.`,
        act: { label: 'What broke', ask: 'what broke the sprout?' },
      });
    const dec = decisions.find((d) => d.t <= T);
    if (dec) {
      const made = dec.made && dec.made.t <= T;
      c.push({
        id: 'decision',
        label: made ? 'A spec clash that was settled' : 'A decision is waiting',
        desc: 'Decision card between two specs',
        text: made
          ? `Two specs clashed and one was kept: “${dec.specs[dec.made.winner]}” over “${dec.specs[dec.made.loser]}”.`
          : `Decision ${dec.card} is waiting: two specs disagree.`,
        act: { label: 'Read the decision', ask: `why was ${dec.task} declined?` },
      });
    }
    const fell = [...drops.values()].filter((d) => d.t <= T);
    if (fell.length) {
      const why = {};
      fell.forEach((d) => {
        const r = /conflict/.test(d.reason)
          ? 'unresolved conflicts'
          : /decision/.test(d.reason)
            ? 'declined by a decision'
            : 'still red after rework';
        why[r] = (why[r] || 0) + 1;
      });
      c.push({
        id: 'drops',
        label: 'Beans that fell off',
        desc: 'Dropped beans and why',
        text: `${plural(fell.length, 'bean')} fell off: ${Object.entries(why)
          .map(([r, n]) => `${n} ${r}`)
          .join(', ')}.`,
        act: { label: 'See what fell off', view: 'fell' },
      });
    }
    const pending = landed - stalk;
    if (pending > 0 && !done)
      c.push({
        id: 'pending',
        label: 'Waiting for validation',
        desc: 'Beans on the sprout, not yet validated',
        text: `${plural(pending, 'bean')} on the sprout ${pending === 1 ? 'is' : 'are'} waiting for validation.`,
        act: { label: 'Show them', ask: "what's on the sprout but not on the stalk?" },
      });
    return c;
  }

  async function renderLead() {
    if (S.focus) {
      const f = S.focus;
      const what = f.byBed
        ? `The plot keeps every area and marks the ${plural(f.beans.size, 'bean')} this is about.`
        : `The plot keeps the ${plural(f.files.size, 'file')} and ${plural(f.beans.size, 'bean')} this is about and folds the rest away.`;
      $('#lead').innerHTML = `<h1>${esc(answerSentence(f))}${pickTag(f.receipts.route, 'routed')}</h1>
        <p>You asked “${esc(f.question)}”. ${what} <button class="linkish" type="button" data-clear>Show the whole repository</button></p>`;
      return;
    }
    const T = S.T;
    const cands = leadCandidates(T);
    const done = T >= TEND;
    const key = 'lead:' + cands.map((c) => c.id).join(',') + ':' + (done ? 'done' : 'live');
    const r = await decideOnce(key, {
      id: 'lead',
      title: 'Lead the first screen',
      ask: 'Pick the three facts a person opening this repository should read first, most important first.',
      state: { done, candidates: cands.map((c) => ({ id: c.id, desc: c.desc })) },
      candidates: cands.map((c) => ({ id: c.id, desc: c.desc, label: c.label })),
      pick: 3,
      rule: () => {
        const order = done
          ? ['growth', 'decision', 'drops', 'red-history']
          : ['red', 'swarm', 'decision', 'pending', 'growth', 'drops', 'red-history'];
        return {
          chosen: order.filter((id) => cands.some((c) => c.id === id)).slice(0, 3),
          why: done
            ? 'Rule: a finished run leads with growth, then decisions, then losses.'
            : 'Rule: a live run leads with anything red, then the swarm, then decisions.',
        };
      },
    });
    if (S.T !== T) return;
    const byId = new Map(cands.map((c) => [c.id, c]));
    const [first, ...rest] = r.chosen.map((id) => byId.get(id)).filter(Boolean);
    const act = (c) =>
      c.act
        ? ` <button class="linkish" type="button" data-act='${esc(JSON.stringify(c.act))}'>${esc(c.act.label)}</button>`
        : '';
    $('#lead').innerHTML =
      `<h1>${esc(first.text)}${pickTag(r)}</h1>${rest.map((c) => `<p>${esc(c.text)}${act(c)}</p>`).join('')}`;
  }

  /* ---------- Chips ---------- */
  function renderChips() {
    const f = S.focus;
    const legend = `<div class="legend"><span><i style="background:var(--leaf);border-radius:0 80% 0 80%"></i>on the stalk</span><span><i style="background:var(--sprout);border-radius:0 80% 0 80%"></i>on the sprout</span><span><i style="background:var(--bean)"></i>in flight</span><span><i style="box-shadow:inset 0 0 0 2px var(--leaf)"></i>tests only</span></div>`;
    if (!f) {
      $('#chips').innerHTML =
        `<span class="chip scope">Whole repository, <b>&nbsp;${M.filePaths.length} files</b></span><span class="chip scope">Run <b>&nbsp;${D.meta.run}</b></span>${legend}`;
      return;
    }
    const chips = [
      `<span class="chip"><b>${esc(CLASS_LABEL[f.cls])}</b>${pickTag(f.receipts.route, 'routed')}<button type="button" data-clear title="Clear the question">×</button></span>`,
    ];
    if (f.term)
      chips.push(
        `<span class="chip">about <b>&nbsp;${esc(f.term)}</b><button type="button" data-clear>×</button></span>`,
      );
    if (f.agent)
      chips.push(
        `<span class="chip">agent <b>&nbsp;${esc(f.agent)}</b><button type="button" data-clear>×</button></span>`,
      );
    if (f.files.size)
      chips.push(
        `<span class="chip"><b>${plural(f.files.size, 'file')}</b>${pickTag(f.receipts.files, 'ranked')}</span>`,
      );
    chips.push(`<span class="chip"><b>${plural(f.beans.size, 'bean')}</b></span>`);
    $('#chips').innerHTML = chips.join('') + legend;
  }

  /* ---------- Ask: route, resolve, arrange ---------- */
  const CLASS_LABEL = {
    'recent-changes': 'Recent changes',
    'who-why': 'Who and why',
    'in-flight': 'In flight now',
    'what-broke': 'What broke',
    'pending-promotion': 'Waiting for the stalk',
    decisions: 'Decisions',
    'tests-for': 'Tests',
    'agent-activity': 'Agent activity',
    bean: 'One bean',
    explore: 'Search',
  };
  const CLASS_DESC = {
    'recent-changes': 'what changed recently in an area or feature',
    'who-why': 'who changed something and why',
    'in-flight': 'what agents are working on right now',
    'what-broke': 'why a check or validation went red',
    'pending-promotion': 'what is on the sprout but not yet on the stalk',
    decisions: 'decisions taken between conflicting specs',
    'tests-for': 'which tests cover something',
    'agent-activity': 'what one agent did',
    bean: 'one bean by id',
    explore: 'anything else: search',
  };
  const RULES = [
    ['bean', /\b(?:show|open)\b.*\bt\d{3}\b|^t\d{3}$/],
    ['decisions', /\bdecid|\bdecision|\bdeclined|\bclash|\bdisagree/],
    ['what-broke', /\bbr(?:oke|eak)|\bred\b|\bfail/],
    ['in-flight', /\bright now\b|\bin flight\b|\bworking on\b|\bswarm\b|\bbusy\b/],
    ['pending-promotion', /\bnot (?:yet )?on (?:the )?stalk|\bsprout but\b|\bwaiting for valid/],
    ['agent-activity', /\ba\d{1,2}\b/],
    ['who-why', /\bwho\b|\bwhy\b/],
    ['tests-for', /\btests?\b.*\bcover|\bwhat tests\b/],
    ['recent-changes', /\bchang|\brecent|\blatest|\bhistory|\bwhat happened\b/],
  ];
  const STOP = new Set(
    'what which where when who whom whose why how is are was were the a an on in of to for and or but with about recently recent changed change changes changing has have had did do does done this that these those right now show me tell happened happening swarm working agents agent sprout stalk declined decided decision broke break red tests test cover covers file files code repo repository there it its be been get got any all most last today'.split(
      ' ',
    ),
  );

  function routeRule(q) {
    for (const [cls, re] of RULES)
      if (re.test(q))
        return {
          chosen: [cls],
          why: `Rule: the words match ${re.source.replace(/\\b/g, '').slice(0, 40)}.`,
        };
    return { chosen: ['explore'], why: 'Rule: no class matched, so search.' };
  }

  function termOf(q) {
    const words = q
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w) && !/^t\d{3}$|^a\d{1,2}$/.test(w));
    return words.join(' ');
  }
  const stem = (w) => w.replace(/(ies)$/, 'y').replace(/([^s])s$/, '$1');

  function rankFiles(term) {
    const words = term.split(' ').filter(Boolean).map(stem);
    if (!words.length) return [];
    const all = new Set([...M.filePaths, ...landings.flatMap((l) => l.files.map((f) => f.path))]);
    const touched = new Set(landings.flatMap((l) => l.files.map((f) => f.path)));
    const scored = [];
    for (const p of all) {
      let s = 0;
      for (const w of words) {
        if (p.toLowerCase().includes(w)) s += 3;
        const n = M.grepCount(p, w);
        if (n) s += Math.min(2, n / 3);
      }
      if (words.length > 1 && words.every((w) => p.toLowerCase().includes(w))) s += 3;
      if (touched.has(p)) s += 0.5;
      if (s >= 1.5) scored.push({ path: p, s });
    }
    return scored.sort((a, b) => b.s - a.s || a.path.localeCompare(b.path)).slice(0, 14);
  }

  async function ask(question) {
    const q = question.trim().toLowerCase();
    if (!q) return clearFocus();
    $('#askInput').value = question;
    const route = await Picker.decide({
      id: 'route',
      title: 'Route the question',
      ask: 'Which kind of question is this?',
      state: { question },
      candidates: Object.keys(CLASS_DESC).map((id) => ({
        id,
        desc: CLASS_DESC[id],
        label: CLASS_LABEL[id],
      })),
      pick: 1,
      rule: () => routeRule(q),
    });
    const cls = route.chosen[0];
    const f = {
      cls,
      question,
      term: '',
      agent: null,
      files: new Set(),
      beans: new Set(),
      receipts: { route },
    };
    const beanId = (q.match(/\bt\d{3}\b/) || [])[0];
    const agent = (q.match(/\ba\d{1,2}\b/) || [])[0];
    f.term = termOf(q);
    let target = { kind: 'answer' };

    if (cls === 'bean' && beanId) {
      f.beans.add(beanId);
      (landingOf.get(beanId)?.files || []).forEach((x) => f.files.add(x.path));
      S.focus = null;
      return openBean(beanId);
    }
    if (cls === 'in-flight') {
      if (S.T >= TEND) {
        S.T = busiestMoment();
        f.jumped = true;
      }
      f.byBed = true;
      const fl = M.inflightAt(S.T);
      fl.forEach((b) => {
        f.beans.add(b.task);
        b.files.forEach((p) => f.files.add(p));
      });
      f.term = '';
    } else if (cls === 'what-broke') {
      const k = tickets[0];
      if (k) {
        f.ticket = k;
        k.suspects.forEach((s) => f.beans.add(s.task));
        k.failing.forEach((p) => f.files.add(p));
        (landingOf.get(k.culprit?.task)?.files || []).forEach((x) => f.files.add(x.path));
      }
      f.term = '';
    } else if (cls === 'decisions') {
      const d = decisions[0];
      if (d) {
        f.decision = d;
        [d.task, ...d.against].forEach((t) => f.beans.add(t));
        (landingOf.get(d.against[0])?.files || []).forEach((x) => f.files.add(x.path));
        (D.beanHeads[d.task]?.files || []).forEach((x) => f.files.add(x.path));
      }
      f.term = '';
    } else if (cls === 'agent-activity' && agent) {
      f.agent = agent;
      f.byBed = true;
      f.term = '';
      for (const [id, pt] of Object.entries(D.meta.per_task))
        if (pt.agent === agent) f.beans.add(id);
      landings
        .filter((l) => f.beans.has(l.task))
        .forEach((l) => l.files.forEach((x) => f.files.add(x.path)));
    } else if (cls === 'pending-promotion') {
      const idx = M.stalkIdxAt(S.T);
      landedBy(S.T)
        .filter((l) => l.idx > idx)
        .forEach((l) => {
          f.beans.add(l.task);
          l.files.forEach((x) => f.files.add(x.path));
        });
      f.term = '';
    } else {
      // recent-changes, who-why, tests-for, explore: resolve the term to files, let the picker rank.
      let ranked = rankFiles(f.term);
      if (cls === 'tests-for')
        ranked = ranked
          .filter((x) => isTest(x.path))
          .concat(ranked.filter((x) => !isTest(x.path)))
          .slice(0, 14);
      if (ranked.length) {
        const files = await Picker.decide({
          id: 'files',
          title: 'Choose the files the answer is about',
          ask: `Which of these files are about “${f.term}”? Pick the most relevant, most relevant first.`,
          state: { question, files: ranked.map((x) => x.path) },
          candidates: ranked.map((x) => ({ id: x.path, desc: x.path })),
          pick: Math.min(8, ranked.length),
          rule: () => ({
            chosen: ranked
              .filter((x) => x.s >= 2.5 || ranked.length <= 6)
              .slice(0, 8)
              .map((x) => x.path)
              .concat(ranked.length && ranked[0].s < 2.5 ? [ranked[0].path] : []),
            why: 'Rule: path matches score 3, content mentions up to 2, files the run changed 0.5; keep scores of 2.5 and up, at most 8.',
          }),
        });
        f.receipts.files = files;
        files.chosen.forEach((p) => f.files.add(p));
      }
      const words = f.term.split(' ').filter(Boolean).map(stem);
      for (const l of landings) {
        const t = tasks.get(l.task);
        const text = (t.title + ' ' + t.intent).toLowerCase();
        if (
          l.files.some((x) => f.files.has(x.path)) &&
          (words.some((w) => text.includes(w)) ||
            l.files.some((x) => f.files.has(x.path) && words.some((w) => x.path.includes(w))))
        )
          f.beans.add(l.task);
      }
      for (const [id] of drops) {
        const t = tasks.get(id);
        if (words.some((w) => (t.title + ' ' + t.intent).toLowerCase().includes(w)))
          f.beans.add(id);
      }
      if (cls === 'who-why') {
        const src = [...f.files].find((p) => !isTest(p) && M.D.files[p]);
        if (src) target = { kind: 'file', id: src, fromAnswer: true };
      }
    }

    // Arrange the pane: the picker orders sections from the catalog; code says which have data.
    const avail = availableSections(f);
    const sections = await Picker.decide({
      id: 'sections',
      title: 'Arrange the answer',
      ask: `For the question “${question}”, which sections should the reader see, in what order?`,
      state: { question, class: cls, sections: avail.map((s) => s.id) },
      candidates: avail.map((s) => ({ id: s.id, desc: s.desc, label: s.label })),
      pick: Math.min(3, avail.length),
      rule: () => {
        const order = SECTION_DEFAULTS[cls] || ['beans', 'changes'];
        return {
          chosen: order.filter((id) => avail.some((s) => s.id === id)).slice(0, 3),
          why: `Rule: the fixed arrangement for “${CLASS_LABEL[cls]}”.`,
        };
      },
    });
    f.receipts.sections = sections;
    f.sections = sections.chosen;
    S.focus = f;
    S.view = target;
    render();
  }

  const SECTION_DEFAULTS = {
    'recent-changes': ['beans', 'changes', 'decision'],
    'who-why': ['file', 'beans'],
    'in-flight': ['swarm', 'beans'],
    'what-broke': ['red', 'beans', 'changes'],
    decisions: ['decision', 'beans', 'changes'],
    'agent-activity': ['beans', 'changes'],
    'pending-promotion': ['beans', 'changes'],
    'tests-for': ['tests', 'beans'],
    explore: ['beans', 'changes'],
  };
  function availableSections(f) {
    const s = [];
    if (f.beans.size)
      s.push({
        id: 'beans',
        label: 'The beans involved',
        desc: 'beans that touched these files, newest first',
      });
    if (f.files.size && landings.some((l) => l.files.some((x) => f.files.has(x.path))))
      s.push({
        id: 'changes',
        label: 'The changes, by file',
        desc: 'diffs of the matched files, per bean',
      });
    if ([...f.files].some((p) => !isTest(p) && D.files[p]))
      s.push({
        id: 'file',
        label: 'Who wrote each line',
        desc: 'the main file with each line attributed to its bean',
      });
    if (decisions.some((d) => f.beans.has(d.task) || d.against.some((a) => f.beans.has(a))))
      s.push({
        id: 'decision',
        label: 'The decision',
        desc: 'the decision card between conflicting specs',
      });
    if (
      tickets.length &&
      (f.ticket || tickets.some((k) => k.suspects.some((x) => f.beans.has(x.task))))
    )
      s.push({
        id: 'red',
        label: 'The red validation',
        desc: 'the red validation, its suspects and culprit',
      });
    if (M.inflightAt(S.T).length)
      s.push({
        id: 'swarm',
        label: 'The swarm right now',
        desc: 'beans in flight, by area, with overlaps',
      });
    if ([...f.files].some(isTest))
      s.push({
        id: 'tests',
        label: 'Tests',
        desc: 'acceptance tests among the files and who added them',
      });
    return s;
  }

  function clearFocus() {
    S.focus = null;
    S.view = { kind: 'overview' };
    $('#askInput').value = '';
    render();
  }

  /* ---------- Pane ---------- */
  function beanState(id) {
    if (drops.has(id) && drops.get(id).t <= S.T)
      return { word: 'fell off', cls: 'red', mk: 'fell' };
    const st = M.stateAt(id, S.T);
    if (st.state === 'stalk') return { word: 'on the stalk', cls: 'green', mk: '' };
    if (st.state === 'landed') return { word: 'on the sprout', cls: 'green', mk: '' };
    if (st.state === 'queued') return { word: 'not started', cls: '', mk: 'fly' };
    return { word: st.state, cls: 'bean', mk: 'fly' };
  }
  function beanList(ids) {
    const sorted = [...ids].sort(
      (a, b) =>
        (landingOf.get(b)?.t || drops.get(b)?.t || 0) -
        (landingOf.get(a)?.t || drops.get(a)?.t || 0),
    );
    return `<ul class="beanlist">${sorted
      .map((id) => {
        const t = tasks.get(id),
          l = landingOf.get(id),
          st = beanState(id);
        const when =
          l && l.t <= S.T
            ? `#${l.idx}, ${clock(l.t)}`
            : drops.get(id)?.t <= S.T
              ? clock(drops.get(id).t)
              : '';
        return `<li data-bean="${id}"><i class="mk ${st.mk}"></i><span class="bt">${esc(t.title)}</span><span class="bm">${esc(when)}</span><span class="sub">${id}, ${esc(D.meta.per_task[id]?.agent || '')}, ${esc(st.word)}</span></li>`;
      })
      .join('')}</ul>`;
  }

  function diffBlock(file, open, sub) {
    const lines = file.lines
      .map(
        (ln) =>
          `<div class="${ln[0] === '+' ? 'a' : ln[0] === '-' ? 'd' : ln.startsWith('@@') ? 'h' : ''}">${esc(ln)}</div>`,
      )
      .join('');
    return `<details class="diff" ${open ? 'open' : ''}><summary><span class="p">${esc(sub || file.path)}</span><span class="n"><span class="add">+${file.additions}</span> <span class="del">−${file.deletions}</span></span></summary><pre>${lines}${file.cut ? '<div class="h">… cut here; open the file for the rest</div>' : ''}</pre></details>`;
  }

  function changesSection(f) {
    const byFile = [...f.files]
      .map((p) => ({
        p,
        ls: landings.filter((l) => l.t <= S.T && l.files.some((x) => x.path === p)),
      }))
      .filter((x) => x.ls.length)
      .sort((a, b) => isTest(a.p) - isTest(b.p) || b.ls.length - a.ls.length);
    return byFile
      .slice(0, 6)
      .map(
        ({ p, ls }, i) =>
          `<p class="kicker" style="margin-top:12px"><span class="mono">${esc(p)}</span>, ${plural(ls.length, 'bean')}</p>` +
          ls
            .slice()
            .reverse()
            .slice(0, 3)
            .map((l, j) =>
              diffBlock(
                l.files.find((x) => x.path === p),
                i === 0 && j === 0,
                `${l.task} ${l.title}`,
              ),
            )
            .join(''),
      )
      .join('');
  }

  const OWNER_COLORS = [
    'var(--bean)',
    'var(--leaf)',
    'var(--pollen)',
    'var(--pick)',
    'var(--blight)',
    'var(--sprout)',
  ];
  function fileSection(path) {
    const file = D.files[path];
    if (!file)
      return '<p class="prose small">This file is not on the stalk at the end of the run.</p>';
    const owners = [...new Set(file.blame.map((b) => b[0]).filter(Boolean))];
    const color = new Map(owners.map((o, i) => [o, OWNER_COLORS[i % OWNER_COLORS.length]]));
    const counts = new Map();
    file.blame.forEach(([o, n]) => o && counts.set(o, (counts.get(o) || 0) + n));
    const lines = file.content.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    let i = 0;
    const out = [];
    for (const [o, n] of file.blame) {
      for (let k = 0; k < n && i < lines.length; k++, i++) {
        out.push(
          `<div class="${o ? 'seg' : ''}" ${o ? `data-bean="${o}" title="${esc(o + ' ' + tasks.get(o).title)}"` : ''}><i class="own" style="background:${o ? color.get(o) : 'transparent'}"></i><span class="ln">${i + 1}</span><span>${esc(lines[i])}</span></div>`,
        );
      }
    }
    return `<div class="owners">${owners.map((o) => `<button type="button" data-bean="${o}"><i style="background:${color.get(o)}"></i><span>${esc(tasks.get(o).title)}</span><small>${o}, ${plural(counts.get(o), 'line')}</small></button>`).join('') || '<span class="prose small">Every line predates the run.</span>'}</div>
      <div class="file"><pre>${out.join('')}</pre></div>`;
  }

  function decisionSection(d) {
    const made = d.made && d.made.t <= S.T;
    return `<div class="story decide"><div class="head2">${esc(d.card)}: two specs could not both hold</div>
      <p><b>${esc(d.task)}</b> “${esc(d.specs[d.task])}”</p>
      <p><b>${esc(d.against[0])}</b> “${esc(d.specs[d.against[0]])}”</p>
      <p>${plural(d.failing.length, 'test')} failed whichever way the agent tried (${d.attempts || 'several'} attempts). ${made ? `Decided after ${d.made.wait_seconds} s for <b>${esc(d.made.winner)}</b>: keep what already landed; ${esc(d.made.loser)} was declined.` : 'Waiting for a person.'}</p>
      <div class="acts"><button type="button" data-bean="${d.task}">Follow ${d.task}</button><button type="button" data-bean="${d.against[0]}">Follow ${d.against[0]}</button></div></div>`;
  }

  function redSection(k) {
    return `<div class="story red"><div class="head2">Red validation ${esc(k.ticket)} at #${k.red_idx}, ${clock(k.t)}</div>
      <p><span class="mono">${esc(short(k.failing[0]))}</span> started failing once ${k.red_idx + 1} beans were on the sprout. ${plural(k.suspects.length, 'bean')} read the files that test depends on, so they were the suspects; bisecting named <b>${esc(k.culprit?.task || '?')}</b> ${k.culprit ? `at ${clock(k.culprit.t)}` : ''}.</p>
      <p>${k.revertConflict ? `Reverting it conflicted in <span class="mono">${esc(short(k.revertConflict.files[0]))}</span>, so the fix came forward instead. ` : ''}Meanwhile ${plural(k.inherited, 'pre-land check')} inherited the red. ${k.greenAgain ? `Green again at #${k.greenAgain.trunk_idx}, ${dur(k.greenAgain.t - k.t)} after it broke.` : ''}</p>
      <div class="acts">${k.culprit ? `<button type="button" data-bean="${k.culprit.task}">Follow ${k.culprit.task}</button>` : ''}</div></div>`;
  }

  function swarmSection() {
    const fl = M.inflightAt(S.T);
    if (!fl.length) return '<p class="prose small">No beans are in flight at this moment.</p>';
    const beds = new Map();
    fl.forEach((b) => {
      const k = [...(b.beds.size ? b.beds : b.predicted)][0] || 'core';
      if (!beds.has(k)) beds.set(k, []);
      beds.get(k).push(b);
    });
    return [...beds]
      .sort((a, b) => b[1].length - a[1].length)
      .map(
        ([bed, bs]) =>
          `<p class="kicker" style="margin-top:10px">${esc(bed)}${bs.length > 1 ? `, ${bs.length} beans side by side` : ''}</p>
       <ul class="beanlist">${bs.map((b) => `<li data-bean="${b.task}"><i class="mk fly"></i><span class="bt">${esc(b.title)}</span><span class="bm">${esc(b.agent || '')}</span><span class="sub">${esc(b.state)}${b.detail ? ': ' + esc(b.detail) : ''}, for ${dur(S.T - b.since)}</span></li>`).join('')}</ul>`,
      )
      .join('');
  }

  function testsSection(f) {
    const tests = [...f.files].filter(isTest);
    return `<ul class="beanlist">${tests
      .map((p) => {
        const owner = D.tasks.find((t) => t.tests.includes(p));
        const fell = owner && drops.has(owner.id);
        return `<li ${owner ? `data-bean="${owner.id}"` : ''}><i class="mk ${fell ? 'fell' : ''}"></i><span class="bt mono">${esc(short(p))}</span><span class="bm">${owner ? owner.id : 'base'}</span><span class="sub">${owner ? esc(owner.title) + (fell ? ', which fell off, so this test fails at the end' : '') : 'in the base repository'}</span></li>`;
      })
      .join('')}</ul>`;
  }

  function answerSentence(f) {
    const n = f.beans.size,
      files = f.files.size;
    if (!n && !files && !['in-flight', 'pending-promotion'].includes(f.cls))
      return `Nothing in this run matches “${f.term || f.question}”. Try an area like billing, a file name, or a bean such as t018.`;
    const landed = [...f.beans].filter((id) => landingOf.get(id)?.t <= S.T).length;
    const fell = [...f.beans].filter((id) => drops.get(id)?.t <= S.T).length;
    switch (f.cls) {
      case 'recent-changes':
      case 'explore':
        return `${plural(landed, 'bean')} changed ${plural(files, 'file')} about ${f.term || 'this'}${fell ? `; ${fell} more fell off` : ''}.`;
      case 'who-why': {
        const main = [...f.files].find((p) => !isTest(p) && D.files[p]);
        const owners = main ? new Set(D.files[main].blame.map((b) => b[0]).filter(Boolean)).size : 0;
        return main
          ? `${plural(owners, 'bean')} rewrote ${short(main)} during the run; the pane colours each line by the bean that last wrote it.`
          : `${plural(landed, 'bean')} changed the code about ${f.term}.`;
      }
      case 'in-flight':
        return `${plural(M.inflightAt(S.T).length, 'bean')} ${M.inflightAt(S.T).length === 1 ? 'is' : 'are'} in flight at ${clock(S.T)}${f.jumped ? ', the run’s busiest minute' : ''}.`;
      case 'what-broke':
        return f.ticket
          ? `${f.ticket.culprit?.task || 'A bean'} broke ${short(f.ticket.failing[0])}; bisecting the ${f.ticket.suspects.length} beans whose read sets covered it named the culprit ${dur((f.ticket.culprit?.t || f.ticket.t) - f.ticket.t)} after the red.`
          : 'Nothing has gone red.';
      case 'decisions':
        return f.decision
          ? `One decision: “${f.decision.specs[f.decision.made?.winner || f.decision.task]}” was kept.`
          : 'No decisions were needed.';
      case 'agent-activity':
        return `${f.agent} worked on ${plural(n, 'bean')}; ${landed} landed${fell ? `, ${fell} fell off` : ''}.`;
      case 'pending-promotion':
        return n
          ? `${plural(n, 'bean')} on the sprout ${n === 1 ? 'is' : 'are'} waiting for validation.`
          : 'Everything on the sprout is on the stalk.';
      case 'tests-for':
        return `${plural([...f.files].filter(isTest).length, 'test file')} about ${f.term}.`;
      default:
        return '';
    }
  }

  function renderAnswer() {
    const f = S.focus;
    const titles = {
      beans: 'The beans involved',
      changes: 'The changes, by file',
      file: 'Who wrote each line',
      decision: 'The decision',
      red: 'The red validation',
      swarm: 'The swarm right now',
      tests: 'Tests',
    };
    const body = f.sections
      .map((id, i) => {
        let inner = '';
        if (id === 'beans') inner = beanList(f.beans);
        if (id === 'changes') inner = changesSection(f);
        if (id === 'file') inner = fileSection([...f.files].find((p) => !isTest(p) && D.files[p]));
        if (id === 'decision') inner = decisionSection(f.decision || decisions[0]);
        if (id === 'red') inner = redSection(f.ticket || tickets[0]);
        if (id === 'swarm') inner = swarmSection();
        if (id === 'tests') inner = testsSection(f);
        return `<h2>${titles[id]}${i === 0 ? pickTag(f.receipts.sections, 'arranged') : ''}</h2>${inner}`;
      })
      .join('');
    return `<button class="back" type="button" data-clear>Back to the whole repository</button>
      <p class="kicker">${esc(CLASS_LABEL[f.cls])}: “${esc(f.question)}”</p>
      ${body}`;
  }

  function renderBean(id) {
    const t = tasks.get(id),
      pt = D.meta.per_task[id] || {},
      l = landingOf.get(id);
    const st = beanState(id);
    const steps = M.journey(id).filter((s) => s.t <= S.T);
    const intent = t.intent.split('\n\n');
    const files = l && l.t <= S.T ? l.files : D.beanHeads[id]?.files || [];
    const dec = decisions.find((d) => d.task === id || d.against.includes(id));
    const cost = M.D.events
      .filter((e) => e.type === 'invocation.end' && e.task === id)
      .reduce((s, e) => s + (e.cost_usd || 0), 0);
    const predicted = (pt.predicted || []).map((p) => (p === 'src' || p === '(root)' ? 'core' : p.replace('src/', ''))).join(', ');
    const actual = (pt.actual_modules || []).map((p) => (p === 'src' || p === '(root)' ? 'core' : p.replace('src/', ''))).join(', ');
    return `<button class="back" type="button" data-back>${S.focus ? 'Back to the answer' : 'Back to the whole repository'}</button>
      <p class="kicker">Bean ${id}, ${esc(t.kind)}, by agent ${esc(pt.agent || '?')}</p>
      <h3>${esc(t.title)}</h3>
      <div class="meta-row"><span class="tag ${st.cls}">${esc(st.word)}</span>${l && l.t <= S.T ? `<span class="tag">#${l.idx} on the line</span>` : ''}${pt.reworks ? `<span class="tag red">${plural(pt.reworks, 'rework')}</span>` : ''}<span class="tag">$${cost.toFixed(2)}</span>${dec ? `<span class="tag decide">${dec.card}</span>` : ''}</div>
      ${intent.map((p) => `<p class="prose">${esc(p).replace(/`([^`]+)`/g, '<span class="mono">$1</span>')}</p>`).join('')}
      ${predicted && actual && predicted !== actual ? `<p class="prose small">The scheduler expected it in ${esc(predicted)}; it wrote in ${esc(actual)}.</p>` : ''}
      <h2>Its journey</h2>
      <ol class="journey">${steps.map((s) => `<li class="${s.kind}"><div class="jt">${clock(s.t)}</div><div class="jx">${esc(s.text)}</div>${s.quote ? `<blockquote>“${esc(s.quote.split('\n')[0].slice(0, 260))}${s.quote.length > 260 ? '…' : ''}”</blockquote>` : ''}</li>`).join('')}</ol>
      ${dec ? `<h2>The decision</h2>${decisionSection(dec)}` : ''}
      ${files.length ? `<h2>${l && l.t <= S.T ? 'What it landed' : 'Its last attempt'}</h2>${files.map((f, i) => diffBlock(f, i === 0)).join('')}` : ''}`;
  }

  async function renderOverview() {
    const T = S.T;
    const fl = M.inflightAt(T);
    const sugg = [
      {
        id: 'coupons',
        q: 'What changed recently on coupons?',
        desc: 'recent changes about a feature many beans touched',
      },
      { id: 'swarm', q: 'Where is the swarm working right now?', desc: 'where agents are working' },
      {
        id: 'decision',
        q: `Why was ${decisions[0]?.task} declined?`,
        desc: 'the decision between two specs',
        need: decisions.some((d) => d.t <= T),
      },
      {
        id: 'red',
        q: 'What broke the sprout?',
        desc: 'the red validation and its culprit',
        need: tickets.some((k) => k.t <= T),
      },
      {
        id: 'tax',
        q: 'Who changed tax rounding and why?',
        desc: 'who wrote a piece of code and why',
      },
      { id: 'agent', q: 'What has a2 done?', desc: 'one agent’s work' },
      {
        id: 'pending',
        q: "What's on the sprout but not on the stalk?",
        desc: 'beans waiting for validation',
        need: landedBy(T).length > M.stalkIdxAt(T) + 1,
      },
    ].filter((s) => s.need !== false);
    const key = 'suggest:' + sugg.map((s) => s.id).join(',') + (fl.length ? ':live' : '');
    const r = await decideOnce(key, {
      id: 'suggest',
      title: 'Suggest questions',
      ask: 'Which four questions would help someone understand this repository right now?',
      state: { inflight: fl.length, suggestions: sugg.map((s) => s.id) },
      candidates: sugg.map((s) => ({ id: s.id, desc: s.desc, label: s.q })),
      pick: 4,
      rule: () => {
        const order = fl.length
          ? ['swarm', 'red', 'pending', 'coupons', 'decision', 'tax', 'agent']
          : ['coupons', 'decision', 'red', 'tax', 'swarm', 'agent', 'pending'];
        return {
          chosen: order.filter((id) => sugg.some((s) => s.id === id)).slice(0, 4),
          why: 'Rule: live runs suggest what is happening; finished runs suggest what happened.',
        };
      },
    });
    if (S.T !== T || S.view.kind !== 'overview') return;
    const byId = new Map(sugg.map((s) => [s.id, s]));
    const fell = [...drops.values()].filter((d) => d.t <= T);
    const am = D.meta.agent_minutes,
      tot = am.busy + am.blocked + am.idle;
    const dec = decisions.find((d) => d.t <= T);
    const k = tickets.find((x) => x.t <= T);
    $('#pane').innerHTML = `
      <h2>Ask${pickTag(r, 'suggested')}</h2>
      <div class="suggest">${r.chosen.map((id) => `<button type="button" data-ask="${esc(byId.get(id).q)}">${esc(byId.get(id).q)}</button>`).join('')}</div>
      ${fl.length ? `<h2>Right now, ${clock(T)}</h2>${swarmSection()}` : ''}
      <h2>What happened</h2>
      ${dec ? decisionSection(dec) : ''}
      ${k ? redSection(k) : ''}
      ${fell.length ? `<div class="story" id="fell"><div class="head2">${plural(fell.length, 'bean')} fell off</div>${beanList(fell.map((d) => d.task))}</div>` : ''}
      ${
        T >= TEND
          ? `<h2>Where the agents’ time went</h2>
      <div class="bar"><i style="width:${(am.busy / tot) * 100}%;background:var(--bean)"></i><i style="width:${(am.blocked / tot) * 100}%;background:var(--pollen)"></i><i style="width:${(am.idle / tot) * 100}%;background:var(--rule)"></i></div>
      <div class="barkey"><span><i style="background:var(--bean)"></i>writing ${Math.round(am.busy)} min</span><span><i style="background:var(--pollen)"></i>holding a bean while it is checked ${Math.round(am.blocked)} min</span><span><i style="background:var(--rule)"></i>idle ${Math.round(am.idle)} min</span></div>
      <div class="facts" style="margin-top:14px"><div><b>$${D.meta.cost_usd.toFixed(2)}</b><span>agent spend</span></div><div><b>${Math.round(D.meta.changes_green_per_hour)}</b><span>green changes an hour</span></div><div><b>${clock(T0 + D.meta.task_start_to_green_seconds.median)}</b><span>median start to green</span></div></div>`
          : ''
      }`;
  }

  async function renderPane() {
    const v = S.view;
    const pane = $('#pane');
    if (v.kind === 'bean') pane.innerHTML = renderBean(v.id);
    else if (v.kind === 'file')
      pane.innerHTML = `<button class="back" type="button" data-back>${S.focus ? 'Back to the answer' : 'Back to the whole repository'}</button>
      <p class="kicker">${S.focus ? `${esc(CLASS_LABEL[S.focus.cls])}: “${esc(S.focus.question)}”` : 'File on the stalk'}</p>
      <h3><span class="mono" style="font-size:19px">${esc(v.id)}</span></h3>
      <h2>Who wrote each line${S.focus?.receipts.sections ? pickTag(S.focus.receipts.sections, 'arranged') : ''}</h2>${fileSection(v.id)}
      ${S.focus && S.focus.beans.size ? `<h2>The beans involved</h2>${beanList(S.focus.beans)}` : ''}`;
    else if (S.focus) pane.innerHTML = renderAnswer();
    else return renderOverview();
    pane.scrollTop = 0;
  }

  function revealSelected() {
    requestAnimationFrame(() => document.querySelector('#plot .row.sel')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
  function openBean(id) {
    S.view = { kind: 'bean', id, prev: S.view.kind === 'bean' ? S.view.prev : S.view };
    render();
    revealSelected();
  }

  /* ---------- Scrubber ---------- */
  function renderTicks() {
    const pos = (t) => ((t - T0) / (TEND - T0)) * 100 + '%';
    $('#ticks').innerHTML =
      landings.map((l) => `<i style="left:${pos(l.t)}"></i>`).join('') +
      M.validations
        .filter((v) => !v.green)
        .map((v) => `<i class="red" style="left:${pos(v.t)}" title="Red validation"></i>`)
        .join('') +
      decisions
        .map((d) => `<i class="decide" style="left:${pos(d.t)}" title="Decision ${d.card}"></i>`)
        .join('');
  }
  function syncClock() {
    $('#timeRange').value = Math.round(((S.T - T0) / (TEND - T0)) * 1000);
    $('#clock').innerHTML = `${clock(S.T)} <small>of ${clock(TEND)}</small>`;
    $('#nowBtn').textContent = S.T >= TEND ? 'End' : 'Go to end';
  }

  let lastFrame = 0;
  function tick(ts) {
    if (!S.playing) return;
    const dt = lastFrame ? (ts - lastFrame) / 1000 : 0;
    lastFrame = ts;
    S.T = Math.min(TEND, S.T + dt * 30);
    renderTime();
    if (S.T >= TEND) return setPlaying(false);
    requestAnimationFrame(tick);
  }
  function setPlaying(on) {
    S.playing = on;
    $('#playIcon').setAttribute('d', on ? 'M4 2.5h3v11H4zM9 2.5h3v11H9z' : 'M4 2.5v11l9-5.5Z');
    $('#playBtn').setAttribute('aria-label', on ? 'Pause' : 'Play the run');
    if (on) {
      if (S.T >= TEND) S.T = T0;
      lastFrame = 0;
      requestAnimationFrame(tick);
    }
  }

  let paneTimer = 0;
  function renderTime() {
    syncClock();
    renderPlot();
    renderLead();
    clearTimeout(paneTimer);
    paneTimer = setTimeout(renderPane, S.playing ? 400 : 60);
  }

  function render() {
    syncClock();
    renderChips();
    renderPlot();
    renderLead();
    renderPane();
  }

  /* ---------- Events ---------- */
  document.addEventListener('click', (e) => {
    const pick = e.target.closest('.pick');
    if (pick) {
      e.stopPropagation();
      return openPopover(pick);
    }
    if (!e.target.closest('#popover')) $('#popover').hidden = true;
    if (e.target.closest('[data-close]')) {
      $('#drawer').hidden = true;
      return;
    }
    const clear = e.target.closest('[data-clear]');
    if (clear) return clearFocus();
    const back = e.target.closest('[data-back]');
    if (back) {
      S.view =
        S.view.prev && S.view.prev.kind !== 'bean'
          ? S.view.prev
          : { kind: S.focus ? 'answer' : 'overview' };
      return render();
    }
    const askBtn = e.target.closest('[data-ask]');
    if (askBtn) return ask(askBtn.dataset.ask);
    const act = e.target.closest('[data-act]');
    if (act) {
      const a = JSON.parse(act.dataset.act);
      if (a.ask) return ask(a.ask);
      if (a.view === 'fell') {
        clearFocus();
        setTimeout(
          () => document.getElementById('fell')?.scrollIntoView({ behavior: 'smooth' }),
          120,
        );
      }
      return;
    }
    const col = e.target.closest('[data-col]');
    if (col) {
      const c = JSON.parse($('#plot').dataset.cols)[Number(col.dataset.col)];
      if (c.includes('/')) {
        S.view = { kind: 'file', id: c, prev: S.view };
        return render();
      }
      return ask(`what changed recently in ${c}?`);
    }
    const bean = e.target.closest('[data-bean]');
    if (bean) return openBean(bean.dataset.bean);
  });
  $('#askForm').addEventListener('submit', (e) => {
    e.preventDefault();
    ask($('#askInput').value);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('#askInput')) {
      e.preventDefault();
      $('#askInput').focus();
    }
    if (e.key === 'Escape') {
      $('#popover').hidden = true;
      $('#drawer').hidden = true;
    }
  });
  $('#picksBtn').addEventListener('click', openDrawer);
  $('#timeRange').addEventListener('input', (e) => {
    setPlaying(false);
    S.T = T0 + (e.target.value / 1000) * (TEND - T0);
    renderTime();
  });
  $('#playBtn').addEventListener('click', () => setPlaying(!S.playing));
  $('#nowBtn').addEventListener('click', () => {
    setPlaying(false);
    S.T = TEND;
    renderTime();
  });
  $('#themeBtn').addEventListener('click', () => {
    const root = document.documentElement;
    const dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try {
      localStorage.setItem('bs-theme', root.dataset.theme);
    } catch {}
  });

  let resizeTimer = 0;
  addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderPlot, 120); });

  /* ---------- Boot ---------- */
  try {
    const th = localStorage.getItem('bs-theme');
    if (th) document.documentElement.dataset.theme = th;
  } catch {}
  const params = new URLSearchParams(location.search);
  if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');
  $('#runLabel').textContent =
    `Recorded run ${D.meta.run}, ${D.meta.config.agents} ${D.meta.agent} agents, ${tasks.size} beans`;
  updatePicksButton();
  renderTicks();
  if (params.get('t')) S.T = T0 + Number(params.get('t'));
  render();
  // Deep links for screenshots and demos: ?ask=…, ?bean=t018, ?file=src/billing/tax.ts, ?picks=1
  (async () => {
    if (params.get('ask')) await ask(params.get('ask'));
    if (params.get('bean')) openBean(params.get('bean'));
    if (params.get('file')) {
      S.view = { kind: 'file', id: params.get('file'), prev: S.view };
      render();
    }
    if (params.get('picks')) setTimeout(openDrawer, 50);
    if (params.get('pop'))
      setTimeout(() => {
        const b = document.querySelectorAll('.pick')[Number(params.get('pop')) - 1];
        if (b) openPopover(b);
      }, 200);
  })();
})();
