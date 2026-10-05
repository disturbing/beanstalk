/*
 * The generated explorer: a question (or nothing) becomes a composition of catalog
 * components. Code computes every component from the run; the picker (Jev in the app, the
 * rule order in this mockup) chooses which components and their order, and says so.
 */
(function () {
  const { esc, short, plural } = K;
  const { landings, landingOf, tasks, drops, decisions, tickets, clock, stalkIdxAt, inflightAt } = M;
  const isTest = (p) => /\.test\.ts$/.test(p);
  const fmt = (t) => clock(t);

  const CATALOG = {
    files: 'Files',
    growing: 'Growing now',
    happened: 'What happened',
    journey: 'Bean journey + diff',
    decision: 'Decision card',
    red: 'Red-validation card',
    overlaps: 'Overlaps + agent activity',
  };

  /* ---------- Routing (the rules; Jev routes in the app) ---------- */
  const STOP = new Set('what which where when who is are was the a an on in of to for and recently recent changed change changes show me tell right now working work being did do does go went sprout stalk red broke break why happened has have done decide decided decision declined about this that'.split(' '));
  function route(q) {
    const s = q.toLowerCase();
    if (/\bdecid|\bdecision|\bdeclin|\bclash/.test(s)) return 'decisions';
    if (/\bbr(?:oke|eak)|\bred\b|\bfail/.test(s)) return 'what-broke';
    if (/\bright now\b|\bworking on\b|\bwho is working\b|\bin flight\b|\bswarm\b/.test(s)) return 'in-flight';
    if (/\ba\d{1,2}\b/.test(s)) return 'agent';
    if (/\bt\d{3}\b/.test(s)) return 'bean';
    return 'recent-changes';
  }
  const termOf = (q) => q.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w) && !/^[ta]\d+$/.test(w));
  const stem = (w) => w.replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
  const areaOf = (q) => M.BED_ORDER.find((b) => new RegExp(`\\b${b}\\b`).test(q.toLowerCase())) || null;

  function rankFiles(words) {
    const all = new Set([...M.filePaths, ...landings.flatMap((l) => l.files.map((f) => f.path))]);
    const scored = [];
    for (const p of all) {
      let s = 0;
      for (const w of words) {
        if (p.toLowerCase().includes(w)) s += 3;
        const n = M.grepCount(p, w);
        if (n) s += Math.min(2, n / 3);
      }
      if (s >= 2.5) scored.push({ p, s });
    }
    return scored.sort((a, b) => b.s - a.s || a.p.localeCompare(b.p)).slice(0, 8).map((x) => x.p);
  }

  /* ---------- Plan: what the explorer shows for this moment and question ---------- */
  function plan(state) {
    const { T, q } = state;
    const flying = inflightAt(T);
    if (state.bean) return beanPlan(state.bean, T, flying, q);
    if (!q) {
      const comps = [...(flying.length ? ['growing'] : []), 'happened', 'files'];
      return { relevant: null, answer: null, comps, html: compose(comps, { T, flying, mode: 'tree' }), why: 'Rule: nothing asked, so the files, then the swarm, then the stories.' };
    }
    const cls = route(q);
    const ctx = { T, flying, q, cls };
    switch (cls) {
      case 'what-broke': {
        const k = tickets.find((x) => x.t <= T);
        if (!k) return answerPlan(ctx, 'Nothing has gone red yet.', [], new Set(), ['files']);
        const files = [k.failing[0], ...(landingOf.get(k.culprit?.task)?.files || []).map((f) => f.path)];
        const rel = new Set([...k.suspects.map((s) => s.task), k.culprit?.task].filter(Boolean));
        return answerPlan({ ...ctx, ticket: k }, `${k.culprit?.task || 'A bean'} turned the sprout red at #${k.red_idx}.`, files, rel, ['red', 'files']);
      }
      case 'decisions': {
        const d = decisions.find((x) => x.t <= T);
        if (!d) return answerPlan(ctx, 'No decisions so far.', [], new Set(), ['files']);
        const files = [...new Set([...(landingOf.get(d.against[0])?.files || []), ...(M.D.beanHeads[d.task]?.files || [])].map((f) => f.path))];
        return answerPlan({ ...ctx, decision: d }, `One decision: “${d.specs[d.against[0]]}” was kept.`, files, new Set([d.task, ...d.against]), ['decision', 'files']);
      }
      case 'in-flight': {
        const area = areaOf(q);
        if (T >= M.TEND) {
          const busiest = busiestMoment();
          return { relevant: new Set(), comps: [], html: compose([], { ...ctx, busiest }, `Nobody, the run finished at ${fmt(M.TEND)}.`), finished: true };
        }
        const here = flying.filter((b) => !area || b.files.some((f) => M.bedOf(f) === area) || b.predicted.includes(area));
        const files = [...new Set(here.flatMap((b) => b.files).filter((f) => !area || M.bedOf(f) === area))].sort();
        const head = here.length ? `${plural(here.length, 'agent')} ${here.length === 1 ? 'is' : 'are'} working${area ? ` on ${area}` : ''} at ${fmt(T)}.` : `Nobody is working${area ? ` on ${area}` : ''} at ${fmt(T)}.`;
        return answerPlan({ ...ctx, area, here }, head, files, new Set(here.map((b) => b.task)), ['overlaps', 'files']);
      }
      case 'agent': {
        const agent = q.match(/\ba\d{1,2}\b/)[0];
        const mine = Object.entries(M.D.meta.per_task).filter(([, v]) => v.agent === agent).map(([k]) => k);
        const files = [...new Set(mine.flatMap((t) => (landingOf.get(t)?.t <= T ? landingOf.get(t).files.map((f) => f.path) : [])))];
        return answerPlan({ ...ctx, agent, mine }, `${agent} worked on ${plural(mine.length, 'bean')}.`, files, new Set(mine), ['overlaps', 'files']);
      }
      default: {
        const words = termOf(q).map(stem);
        const files = rankFiles(words).sort((a, b) => isTest(a) - isTest(b));
        const beans = landings.filter((l) => l.t <= T && l.files.some((f) => files.includes(f.path))).map((l) => l.task);
        const fly = flying.filter((b) => b.files.some((f) => files.includes(f))).map((b) => b.task);
        const newest = landings.filter((l) => beans.includes(l.task)).sort((a, b) => b.idx - a.idx)[0];
        const comps = ['files', ...(fly.length ? ['overlaps'] : []), ...(newest ? ['journey'] : [])];
        return answerPlan({ ...ctx, newest: newest?.task, here: flying.filter((b) => fly.includes(b.task)) }, `${plural(beans.length, 'bean')} changed ${plural(files.length, 'file')} about ${words.join(' ')}${fly.length ? `; ${fly.length} more in flight` : ''}.`, files, new Set([...beans, ...fly]), comps);
      }
    }
  }

  function answerPlan(ctx, sentence, files, relevant, comps) {
    const html = compose(comps, { ...ctx, files, mode: 'answer' }, sentence);
    return { relevant, comps, html, why: `Rule: the arrangement for this kind of question (${ctx.cls}).` };
  }

  function beanPlan(task, T, flying, q) {
    const l = landingOf.get(task);
    const files = (l && l.t <= T ? l.files : M.D.beanHeads[task]?.files || []).map((f) => f.path);
    const comps = ['journey', 'files'];
    const d = decisions.find((x) => x.t <= T && (x.task === task || x.against.includes(task)));
    if (d) comps.splice(1, 0, 'decision');
    return { relevant: new Set([task]), comps, html: compose(comps, { T, flying, files, mode: 'bean', bean: task, decision: d, q }, null) };
  }

  /* ---------- Composition ---------- */
  function compose(comps, ctx, sentence) {
    const order = comps.map((c) => `<span class="c"><b>${comps.indexOf(c) + 1}</b>${CATALOG[c]}</span>`).join('');
    const left = Object.keys(CATALOG).filter((c) => !comps.includes(c)).map((c) => CATALOG[c]).join(', ');
    const busiest = ctx.busiest ? `<a href="#" class="btn sm" data-t="${Math.round(ctx.busiest - M.T0)}">Show the busiest moment (${fmt(ctx.busiest)})</a>` : '';
    const head = sentence ? `<div class="answer">${esc(sentence)}</div><div class="sub">You asked “${esc(ctx.q)}”.<a href="?t=${Math.round(ctx.T - M.T0)}" data-clear>Clear the question</a></div>${busiest ? `<div style="margin-top:12px">${busiest}</div>` : ''}` : '';
    const body = comps.map((c) => `<div class="comp">${COMPONENTS[c](ctx)}</div>`).join('');
    const empty = !ctx.q && !ctx.bean;
    const line = empty || !comps.length ? '' : `<div class="compose">This view: ${order}${info(`Picked from the catalog: ${Object.values(CATALOG).join(', ')}. Left out: ${left || 'none'}. In the app Jev picks these; this mockup shows the rule order.`)}</div>`;
    return infoize(`${askBlock(ctx)}${head}${line}${body}`);
  }

  function askBlock(ctx) {
    const sugg = ['What changed recently on coupons?', 'Why did the sprout go red?', 'Who is working on billing right now?', 'What did we decide?'];
    return `<form class="ask" id="askForm"><span class="q">?</span><input name="q" value="${esc(ctx.q || '')}" placeholder="Ask the beanstalk anything" autocomplete="off"><kbd>/</kbd></form>
      ${ctx.q ? '' : `<div class="asked">${sugg.map((s) => `<a href="#" data-ask="${esc(s)}">${esc(s)}</a>`).join('')}<span class="picked" title="Suggested for this moment">picked</span></div>`}`;
  }

  const COMPONENTS = {
    files(ctx) {
      if (ctx.mode === 'tree') {
        return `<div class="box"><div class="boxhead">${K.branchButton(ctx.T)}<span class="right"><button class="btn sm">Go to file</button></span></div>${K.fileTable('src', ctx.T, { hideUnchanged: true })}</div>`;
      }
      const files = ctx.files || [];
      if (!files.length) return `<div class="box"><div class="boxhead"><b>Files</b></div><div class="empty">No files for this answer.</div></div>`;
      const withDiff = ctx.mode !== 'bean';
      const rows = files.map((p, i) => {
        const l = K.lastLanding([p], ctx.T);
        const fl = K.inflightOn(p, ctx.T, ctx.flying);
        const f = l?.files.find((x) => x.path === p);
        const flyChip = fl.length ? `<span class="chip fly" title="${esc(fl.map((b) => b.agent + ': ' + b.title).join('\n'))}"><i class="budd pulse"></i>${fl.length} in flight</span>` : '';
        const summary = `<span class="p">${K.ICON.file}<code>${esc(p.replace(/^src\//, ''))}</code></span><span class="n">${K.beanChip(l, ctx.T)} ${flyChip}</span><span class="n">${f ? `<span class="add">+${f.additions}</span> <span class="del">−${f.deletions}</span>` : ''}</span>`;
        if (!withDiff || !f) return `<details><summary>${summary}</summary></details>`;
        const lines = f.lines.slice(0, 26).map((ln) => `<div class="${ln[0] === '+' ? 'a' : ln[0] === '-' ? 'd' : ln.startsWith('@@') ? 'h' : ''}">${esc(ln)}</div>`).join('');
        return `<details ${i === 0 ? 'open' : ''}><summary>${summary}</summary><div class="hunk">${lines}</div></details>`;
      }).join('');
      return `<div class="box diffs"><div class="boxhead"><b>Files</b><span class="muted">${plural(files.length, 'file')}${withDiff ? ', newest change of each' : ''}</span><span class="right">${K.branchButton(ctx.T).split('</button>')[0]}</button></span></div>${rows}</div>`;
    },

    growing(ctx) {
      return `<div class="box"><div class="boxhead"><b>Growing now</b><span class="muted">${plural(ctx.flying.length, 'bean')} in flight at ${fmt(ctx.T)}</span></div><ul class="growlist">${ctx.flying.map((b) => `<li data-bean="${b.task}"><span class="a">${b.agent}</span><span class="t">${esc(b.title)}</span><span class="s"><i class="budd ${b.state === 'checking' ? 'checking' : b.state === 'reworking' ? 'reworking' : 'pulse'}"></i> ${b.state}</span></li>`).join('')}</ul></div>`;
    },

    happened(ctx) {
      return `<div class="box"><div class="boxhead"><b>What happened</b></div>${K.stories(ctx.T)}</div>`;
    },

    journey(ctx) {
      const task = ctx.bean || ctx.newest;
      const t = tasks.get(task), pt = M.D.meta.per_task[task] || {};
      const l = landingOf.get(task);
      const st = M.stateAt(task, ctx.T);
      const word = { stalk: 'on the stalk', landed: 'on the sprout', dropped: 'fell off', reworking: 'reworking', checking: 'being checked', writing: 'being written', deciding: 'waiting on a decision', queued: 'not started' }[st.state] || st.state;
      const chip = st.state === 'stalk' ? 'stalk' : st.state === 'landed' ? 'sprout' : st.state === 'dropped' ? 'red' : 'fly';
      const steps = M.journey(task).filter((s) => s.t <= ctx.T);
      const files = l && l.t <= ctx.T ? l.files : M.D.beanHeads[task]?.files || [];
      const diff = files.slice(0, 3).map((f, i) => `<details ${i === 0 ? 'open' : ''}><summary><span class="p">${K.ICON.file}<code>${esc(f.path.replace(/^src\//, ''))}</code></span><span></span><span class="n"><span class="add">+${f.additions}</span> <span class="del">−${f.deletions}</span></span></summary><div class="hunk">${f.lines.slice(0, 20).map((ln) => `<div class="${ln[0] === '+' ? 'a' : ln[0] === '-' ? 'd' : ln.startsWith('@@') ? 'h' : ''}">${esc(ln)}</div>`).join('')}</div></details>`).join('');
      return `<div class="box diffs"><div class="beanhead"><h3>${esc(t.title)}</h3><div class="meta"><span class="chip ${chip}">${word}</span><span>${task}</span><span>by ${pt.agent || '?'}</span>${l ? `<span>#${l.idx}</span>` : ''}${pt.reworks ? `<span class="chip red">${plural(pt.reworks, 'rework')}</span>` : ''}</div>
        <p>${esc(t.intent.split('\n\n')[0]).replace(/`([^`]+)`/g, '<code>$1</code>')}</p></div>
        <div style="display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)"><ol class="journey">${steps.map((s) => `<li class="${s.kind}"><span class="w">${fmt(s.t)}</span>${esc(s.text)}${s.quote && s.kind === 'agent' ? `<q>${esc(s.quote.split('\n')[0].slice(0, 140))}${s.quote.length > 140 ? '…' : ''}</q>` : ''}</li>`).join('')}</ol>
        <div style="border-left:1px solid var(--border-muted)">${diff || '<div class="empty">No change yet.</div>'}</div></div></div>`;
    },

    decision(ctx) {
      const d = ctx.decision;
      const made = d.made && d.made.t <= ctx.T;
      const win = made ? d.made.winner : null;
      const side = (task) => `<div class="${win === task ? 'win' : ''}"><small>${task}${win === task ? ', kept' : win ? ', declined' : ''}</small>${esc(d.specs[task])}</div>`;
      return `<div class="box"><div class="boxhead"><span style="color:var(--pick)">${K.ICON.decide}</span><b>Decision ${d.card}: two specs could not both hold</b><span class="right">${made ? `decided at ${fmt(d.made.t)}` : 'waiting for a person'}</span></div>
        <div class="cardbody"><div class="vs">${side(d.against[0])}${side(d.task)}</div><p>${plural(d.failing.length, 'test')} failed whichever way the agent tried, so the forge asked instead of guessing. ${made ? `It kept what had already landed (${d.made.oracle}) after ${d.made.wait_seconds} s.` : ''}</p>
        <div class="acts"><a href="#" data-bean="${d.task}">Follow ${d.task}</a> <a href="#" data-bean="${d.against[0]}">Follow ${d.against[0]}</a></div></div></div>`;
    },

    red(ctx) {
      const k = ctx.ticket;
      const back = k.greenAgain && k.greenAgain.t <= ctx.T;
      const culprit = k.culprit && k.culprit.t <= ctx.T ? k.culprit.task : null;
      return `<div class="box"><div class="boxhead"><span style="color:var(--red)">${K.ICON.x}</span><b>Red validation ${k.ticket} at #${k.red_idx}</b><span class="right">${back ? `green again at ${fmt(k.greenAgain.t)}` : 'still red'}</span></div>
        <div class="cardbody"><p><code>${esc(short(k.failing[0]))}</code> failed when the sprout was validated at #${k.red_idx}. ${plural(k.suspects.length, 'bean')} had read files that test depends on:</p>
        <div class="suspects">${k.suspects.map((s) => `<a href="#" data-bean="${s.task}" class="chip ${s.task === culprit ? 'red' : 'stalk'}"><i class="leaf ${s.task === culprit ? 'red' : ''}"></i>${s.task} #${s.idx}</a>`).join('')}</div>
        <div class="steps"><div><b>${fmt(k.t)}</b>went red</div><div><b>${plural(k.suspects.length, 'suspect')}</b>by read set</div><div><b>${culprit || 'bisecting'}</b>${culprit ? `named at ${fmt(k.culprit.t)}` : 'in progress'}</div><div><b>${back ? fmt(k.greenAgain.t) : 'not yet'}</b>green again${k.revertConflict ? ', fixed forward' : ''}</div></div>
        ${k.revertConflict ? `<p style="margin-top:10px">Reverting ${culprit} conflicted in <code>${esc(short(k.revertConflict.files[0]))}</code>, so the next landings fixed it forward. ${plural(k.inherited, 'pre-land check')} inherited the red meanwhile.</p>` : ''}
        <div class="acts">${culprit ? `<a href="#" data-bean="${culprit}">Open ${culprit}'s journey</a>` : ''}</div></div></div>`;
    },

    overlaps(ctx) {
      if (ctx.agent) {
        return `<div class="box"><div class="boxhead"><b>Agent activity: ${ctx.agent}</b></div><table class="agents">${ctx.mine.map((t) => { const s = M.stateAt(t, ctx.T); return `<tr data-bean="${t}"><td class="a">${t}</td><td class="t">${esc(tasks.get(t).title)}</td><td class="muted">${s.state}</td></tr>`; }).join('')}</table></div>`;
      }
      const here = ctx.here || [];
      const owners = new Map();
      for (const b of here) for (const f of b.files) if (!ctx.area || M.bedOf(f) === ctx.area) owners.set(f, [...(owners.get(f) || []), b]);
      const hot = [...owners].filter(([, bs]) => bs.length > 1).sort((a, b) => b[1].length - a[1].length);
      const conflicts = M.D.events.filter((e) => e.type === 'merge.conflict' && e.t <= ctx.T && e.t > ctx.T - 240 && e.files.some((f) => !ctx.area || M.bedOf(f) === ctx.area));
      return `<div class="two"><div class="box"><div class="boxhead"><b>Who is working here now</b><span class="muted">${fmt(ctx.T)}</span></div>
          <table class="agents">${here.map((b) => `<tr data-bean="${b.task}"><td class="a">${b.agent}</td><td class="t">${esc(b.title)}<div class="muted" style="font-size:12px">${b.files.filter((f) => !ctx.area || M.bedOf(f) === ctx.area).map(short).join(', ') || 'no files written yet'}</div></td><td><span class="chip ${b.state === 'reworking' ? 'red' : b.state === 'checking' ? 'amber' : 'fly'}">${b.state}</span><div class="muted" style="font-size:11px;text-align:right">for ${M.dur(ctx.T - b.since)}</div></td></tr>`).join('') || '<tr><td class="muted">Nobody right now.</td></tr>'}</table></div>
        <div class="box"><div class="boxhead"><b>Collision hot spots</b><span class="muted">files two beans in flight both change</span></div>
          ${hot.map(([f, bs]) => `<div class="hot"><span>${K.ICON.file}<code>${esc(f.replace(/^src\//, ''))}</code></span><span class="who">${bs.map((b) => `<span class="chip fly">${b.agent}</span>`).join('')}</span></div>`).join('') || '<div class="empty">No two beans touch the same file.</div>'}
          ${conflicts.length ? `<div class="note">${plural(conflicts.length, 'merge conflict')} here in the last 4 minutes: ${[...new Set(conflicts.map((c) => c.task))].join(', ')} went back to their authors.</div>` : ''}
          <div class="note">The forge checks each bean on the merged tree before it lands, so these do not collide on the sprout; the later one is re-checked or reworked.</div></div></div>`;
    },
  };

  /** Receipts live behind a small info icon. */
  function info(text) {
    return `<button type="button" class="info" aria-label="Why these" title="${esc(text)}"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M0 8a8 8 0 1 1 16 0A8 8 0 0 1 0 8Zm8-6.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM6.5 7.75A.75.75 0 0 1 7.25 7h1a.75.75 0 0 1 .75.75v2.75h.25a.75.75 0 0 1 0 1.5h-2a.75.75 0 0 1 0-1.5h.25v-2h-.25a.75.75 0 0 1-.75-.75ZM8 6a1 1 0 1 1 0-2 1 1 0 0 1 0 2Z"/></svg></button>`;
  }
  function infoize(html) {
    return html.replace(/<span class="picked" title="([^"]*)">[^<]*<\/span>/g, (_, title) => info(title.replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
  }
  function busiestMoment() {
    const samples = [];
    for (let t = M.T0 + 30; t < M.TEND; t += 10) samples.push({ t, n: inflightAt(t).length });
    const most = Math.max(...samples.map((x) => x.n));
    const busiest = samples.filter((x) => x.n === most);
    return busiest[Math.floor(busiest.length / 2)].t;
  }

  window.Explorer = { plan, route, CATALOG };
})();
