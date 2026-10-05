/*
 * Shared helpers for the four design options: the recorded run (data.js + model.js from
 * ../repo-experience), a GitHub-grade shell, file tables woven with beans, blame by bean,
 * and the "What happened" stories. Each option draws its own beanstalk.
 */
(function () {
  const { D, T0, TEND, tasks, landings, drops, decisions, tickets, clock, stalkIdxAt, inflightAt } = M;
  const params = new URLSearchParams(location.search);
  if (params.get('theme')) document.documentElement.dataset.theme = params.get('theme');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const short = (p) => p.split('/').pop();
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const ICON = {
    leaf: '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M8 15V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/><path d="M8 9c0-3 2.2-5 5.5-5 0 3-2.2 5-5.5 5Z" fill="#1a7f37"/><path d="M8 6.5C8 4.2 6.3 2.5 3.5 2.5c0 2.3 1.7 4 4.5 4Z" fill="#7cb518"/></svg>',
    code: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="m11.28 3.22 4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06-1.06L13.94 8l-3.72-3.72a.749.749 0 0 1 1.06-1.06Zm-6.56 0a.751.751 0 0 1 1.06 1.06L2.06 8l3.72 3.72a.749.749 0 0 1-1.06 1.06L.47 8.53a.75.75 0 0 1 0-1.06Z"/></svg>',
    bean: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5 2.5c3-1.5 8 1 8.5 5 .5 4-3.5 7-7 6S1 9 2.5 6c.6-1.3 1.3-2.8 2.5-3.5Z"/></svg>',
    stalk: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 15V1.5"/><path d="M8 10c2.5 0 4-1.5 4-4M8 6.5C5.8 6.5 4.5 5 4.5 3"/></svg>',
    check: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.751.751 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z"/></svg>',
    decide: '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5 14.5 8 8 14.5 1.5 8Z"/></svg>',
    x: '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.06 1.06L9.06 8l3.22 3.22a.749.749 0 0 1-1.06 1.06L8 9.06l-3.22 3.22a.749.749 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z"/></svg>',
    dot: '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="4"/></svg>',
    graph: '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.5 1.75V13.5h13.75a.75.75 0 0 1 0 1.5H.75a.75.75 0 0 1-.75-.75V1.75a.75.75 0 0 1 1.5 0Zm14.28 2.53-5.25 5.25a.75.75 0 0 1-1.06 0L7 7.06 4.28 9.78a.751.751 0 0 1-1.06-1.06l3.25-3.25a.75.75 0 0 1 1.06 0L10 7.94l4.72-4.72a.751.751 0 0 1 1.06 1.06Z"/></svg>',
    dir: '<svg class="ficon dir" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/></svg>',
    file: '<svg class="ficon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1.75C2 .784 2.784 0 3.75 0h6.586c.464 0 .909.184 1.237.513l2.914 2.914c.329.328.513.773.513 1.237v9.586A1.75 1.75 0 0 1 13.25 16h-9.5A1.75 1.75 0 0 1 2 14.25Zm1.75-.25a.25.25 0 0 0-.25.25v12.5c0 .138.112.25.25.25h9.5a.25.25 0 0 0 .25-.25V6h-2.75A1.75 1.75 0 0 1 9 4.25V1.5Zm6.75.062V4.25c0 .138.112.25.25.25h2.688l-.011-.013-2.914-2.914-.013-.011Z"/></svg>',
  };

  /** Race second shown: ?t= seconds into the run, or the option's default. */
  function moment(defaultSeconds) {
    const t = params.get('t');
    if (t === 'end') return TEND;
    const n = t === null ? defaultSeconds : Number(t);
    return n === null ? TEND : Math.min(TEND, T0 + n);
  }

  function leafState(l, T) {
    if (tickets.some((k) => k.culprit && k.culprit.task === l.task && k.culprit.t <= T)) return 'red';
    return l.idx <= stalkIdxAt(T) ? 'stalk' : 'sprout';
  }

  /** The newest landing at or before T that touched any of `paths`. */
  function lastLanding(paths, T) {
    const set = new Set(paths);
    let best = null;
    for (const l of landings) if (l.t <= T && l.files.some((f) => set.has(f.path) || [...set].some((p) => f.path.startsWith(p + '/'))) && (!best || l.idx > best.idx)) best = l;
    return best;
  }

  function beanChip(l, T, opts = {}) {
    if (!l) return '<span class="chip" style="color:var(--fg-subtle);border-color:var(--border-muted)">base</span>';
    const s = leafState(l, T);
    const cls = s === 'red' ? 'red' : s;
    return `<span class="chip ${cls}" title="${esc(l.title)}"><i class="leaf ${s === 'stalk' ? '' : s}"></i>${l.task}${opts.noIdx ? '' : ` #${l.idx}`}</span>`;
  }

  function budChip(b) {
    const cls = b.state === 'checking' ? 'checking' : b.state === 'reworking' ? 'reworking' : '';
    return `<span class="chip fly" title="${esc(b.title)} (${b.state})"><i class="budd ${cls} ${b.state === 'writing' ? 'pulse' : ''}"></i>${b.agent} ${b.state}</span>`;
  }

  function allPaths() {
    return Object.keys(D.files);
  }

  /** Entries of a directory: folders first, then files. */
  function dirEntries(dir) {
    const prefix = dir === '' ? '' : dir + '/';
    const dirs = new Set();
    const files = [];
    for (const p of allPaths()) {
      if (!p.startsWith(prefix)) continue;
      const rest = p.slice(prefix.length);
      if (rest.includes('/')) dirs.add(prefix + rest.split('/')[0]);
      else files.push(p);
    }
    return [...[...dirs].sort().map((path) => ({ path, dir: true })), ...files.sort().map((path) => ({ path, dir: false }))];
  }

  function inflightOn(path, T, flying) {
    return flying.filter((b) => b.files.some((f) => f === path || f.startsWith(path + '/')));
  }

  /** A GitHub-style directory table, each row with its last bean and any beans in flight. */
  function fileTable(dir, T, opts = {}) {
    const flying = inflightAt(T);
    const entries = dirEntries(dir);
    const shown = opts.hideUnchanged ? entries.filter((e) => e.dir || lastLanding([e.path], T) || inflightOn(e.path, T, flying).length) : entries;
    const hidden = entries.length - shown.length;
    const rows = shown.map((e) => {
      const l = lastLanding([e.path], T);
      const fl = inflightOn(e.path, T, flying);
      const msg = l ? `<a href="#">${esc(l.title)}</a>` : '<span class="subtle">unchanged this run</span>';
      const fly = fl.length ? ` <span class="chip fly" title="${esc(fl.map((b) => b.agent + ': ' + b.title).join('\n'))}"><i class="budd pulse"></i>${fl.length} in flight</span>` : '';
      const extra = opts.extra ? opts.extra(e, l, fl) : '';
      return `<tr${opts.sel === e.path ? ' class="sel"' : ''}><td class="name">${e.dir ? ICON.dir : ICON.file}<a href="#">${esc(short(e.path))}</a></td>
        <td class="msg">${beanChip(l, T)} ${msg}${fly}</td>${extra}<td class="when">${l ? clock(l.t) : ''}</td></tr>`;
    });
    if (hidden) rows.push(`<tr><td colspan="3" class="subtle" style="font-size:12px">and ${hidden} files unchanged this run</td></tr>`);
    return `<table class="ftable">${rows.join('')}</table>`;
  }

  /** The final file with each run of lines named by the bean that last wrote it. */
  function codeView(path, maxLines = 40, T = TEND) {
    const f = D.files[path];
    const lines = f.content.split('\n');
    const out = [];
    let i = 0;
    for (const [owner, n] of f.blame) {
      for (let k = 0; k < n && i < lines.length && i < maxLines; k++, i++) {
        const l = owner ? M.landingOf.get(owner) : null;
        const label = k === 0 ? (l ? `${beanChip(l, T, { noIdx: true })} <span class="subtle">#${l.idx}</span>` : '<span class="subtle">base</span>') : '';
        out.push(`<div class="ln ${owner ? 'fresh' : ''}"><div class="bl ${k === 0 ? 'start' : ''}">${label}</div><div class="no">${i + 1}</div><div class="tx">${esc(lines[i])}</div></div>`);
      }
    }
    return `<div class="code">${out.join('')}</div>`;
  }

  /** Beans whose lines are in the final file, newest first. */
  function fileOwners(path) {
    const owners = [...new Set(D.files[path].blame.map((b) => b[0]).filter(Boolean))];
    return owners.map((o) => M.landingOf.get(o)).filter(Boolean).sort((a, b) => b.idx - a.idx);
  }

  function stories(T) {
    const out = [];
    const d = decisions.find((x) => x.t <= T);
    if (d) {
      const made = d.made && d.made.t <= T;
      out.push(`<div class="story"><span class="ic decide">${ICON.decide}</span><div><b>${d.card}: two specs clashed</b> <span class="picked" title="Jev ranked this story first">picked</span>
        <p>“${esc(d.specs[d.against[0]])}” ${made ? 'was kept over' : 'against'} “${esc(d.specs[d.task])}”. ${made ? `Decided in ${d.made.wait_seconds} s; ${d.task} was declined.` : 'Waiting for a person.'}</p></div></div>`);
    }
    const k = tickets.find((x) => x.t <= T);
    if (k) {
      const back = k.greenAgain && k.greenAgain.t <= T;
      out.push(`<div class="story"><span class="ic red">${ICON.x}</span><div><b>The sprout went red at #${k.red_idx}</b>
        <p><code>${esc(short(k.failing[0]))}</code> failed. ${k.culprit && k.culprit.t <= T ? `Read sets narrowed it to ${k.suspects.length} beans; bisecting named <b>${k.culprit.task}</b>.` : `${k.suspects.length} suspects by read set.`} ${back ? `Green again ${Math.round((k.greenAgain.t - k.t) / 60 * 10) / 10} min later.` : 'Still red.'}</p></div></div>`);
    }
    const fell = [...drops.values()].filter((x) => x.t <= T);
    if (fell.length) {
      out.push(`<div class="story"><span class="ic fell">${ICON.dot}</span><div><b>${plural(fell.length, 'bean')} fell off</b>
        <p>${fell.map((x) => `${x.task} (${/conflict/.test(x.reason) ? 'conflict' : /decision/.test(x.reason) ? 'declined' : 'still red'})`).join(', ')}</p></div></div>`);
    }
    return out.join('') || '<div class="story"><span class="ic fell">' + ICON.dot + '</span><div><b>Nothing to report yet</b><p>No decisions, reds or dropped beans so far.</p></div></div>';
  }

  /** The repo header: owner/name, the line selector and the tabs. */
  function repoHead(active, opts = {}) {
    const T = opts.T ?? TEND;
    const green = landings.filter((l) => l.idx <= stalkIdxAt(T) && l.t <= T).length;
    const flying = inflightAt(T).length;
    const tab = (id, icon, label, count) => `<a class="tab ${active === id ? 'on' : ''}" href="${opts.href ? opts.href(id) : '#'}">${icon}${label}${count !== undefined ? ` <span class="count">${count}</span>` : ''}</a>`;
    return `<header class="gh"><a class="logo" href="#">${ICON.leaf}beanstalk</a><nav class="crumbs"><span>coop</span><span>/</span><b>beanstalk-shop</b></nav><span class="spacer"></span>${opts.headerExtra || ''}<span class="avatar"></span></header>
      <div class="repohead"><div class="repotitle">${ICON.bean}<a href="#">coop</a><span class="muted">/</span><b><a href="#">beanstalk-shop</a></b><span class="badge">12 agents</span><span class="badge">run 7z4j84eqvl</span>
      <div class="repoactions"><button class="btn sm">${ICON.stalk} Watch</button><button class="btn sm">${ICON.bean} New bean</button></div></div>
      <nav class="tabs">${tab('code', ICON.code, 'Code')}${tab('beans', ICON.bean, 'Beans', flying)}${tab('stalk', ICON.stalk, 'Stalk', green)}${tab('decisions', ICON.decide, 'Decisions', decisions.length)}${tab('checks', ICON.check, 'Checks')}${tab('insights', ICON.graph, 'Insights')}</nav></div>`;
  }

  function branchButton(T) {
    const s = stalkIdxAt(T);
    const n = landings.filter((l) => l.t <= T).length;
    return `<button class="btn branch"><span class="dot"></span>sprout <span class="muted" style="font-weight:400">#${n - 1}</span> ▾</button><span class="muted" style="font-size:13px">stalk at <b style="color:var(--leaf)">#${s}</b>${n - 1 - s > 0 ? `, ${n - 1 - s} behind` : ', caught up'}</span>`;
  }

  function askBox(placeholder, suggestions = []) {
    return `<form class="ask" onsubmit="return false"><span class="q">?</span><input placeholder="${esc(placeholder)}"><kbd>/</kbd></form>
      ${suggestions.length ? `<div class="asked">${suggestions.map((s) => `<a href="#">${esc(s)}</a>`).join('')}<span class="picked" title="Jev picked these questions for this moment">picked</span></div>` : ''}`;
  }

  /** A compact file tree for one directory: name, a leaf in the colour of its last bean, buds in flight. */
  function miniTree(dir, T, sel) {
    const flying = inflightAt(T);
    const parts = dir.split('/');
    const crumbs = parts.map((p, i) => `<div class="mt-row mt-dir" style="padding-left:${10 + i * 14}px">${ICON.dir}${esc(p)}</div>`).join('');
    const entries = dirEntries(dir);
    const shown = opts.hideUnchanged ? entries.filter((e) => e.dir || lastLanding([e.path], T) || inflightOn(e.path, T, flying).length) : entries;
    const hidden = entries.length - shown.length;
    const rows = shown.map((e) => {
      const l = lastLanding([e.path], T);
      const fl = inflightOn(e.path, T, flying);
      const s = l ? leafState(l, T) : null;
      return `<div class="mt-row ${sel === e.path ? 'on' : ''}" style="padding-left:${10 + parts.length * 14}px">${e.dir ? ICON.dir : ICON.file}<span class="mt-name">${esc(short(e.path))}</span>${fl.length ? `<i class="budd pulse" title="${fl.length} in flight"></i>` : ''}${l ? `<i class="leaf ${s === 'stalk' ? '' : s}" title="${l.task} #${l.idx}"></i>` : ''}</div>`;
    }).join('');
    return `<div class="mtree">${crumbs}${rows}</div>`;
  }

  window.K = { miniTree, ICON, esc, short, plural, moment, leafState, lastLanding, beanChip, budChip, dirEntries, fileTable, codeView, fileOwners, stories, repoHead, branchButton, askBox, params, inflightOn };
})();
