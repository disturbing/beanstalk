// The hero's app replay: an HTML recreation of the repository home coming to life. The Ask box
// types "Replay last week's work", the picked view appears, then the stalk replays a week of
// work with the player running. Every frame is a pure function of the elapsed time, so reduced
// motion simply shows the finished frame. `?demo=<ms>` freezes the replay at that time (for
// screenshots).

const QUESTION = "Replay last week's work";
const AT = {
  type: 700,
  charMs: 60,
  enter: 2350,
  picked: 2650,
  answer: 2950,
  grow: 3250,
  events: 3550,
  play: 4100,
  replayMs: 11000,
  hold: 6500,
};
AT.end = AT.play + AT.replayMs;
AT.loop = AT.end + AT.hold;

const REPLAY_TITLES = [
  'Show thousands separators in displayed amounts',
  'Reserving zero or negative quantities should fail',
  'Split the per-line work out of buildInvoice',
  'Work out session expiry in one place',
  'Limit how many units of one product fit in a cart',
  'Limit how many times a coupon can be redeemed',
  'Paged lists should report the total number',
  'Move the coupon rules out of discounts',
  'Active customers are logged out mid-session',
  'Tracking numbers belong to shipments',
  'Invoice numbers should restart every year',
  'Customers in Quebec are charged the wrong tax',
  'Shipping emails should include the tracking link',
  'Let customers reorder a previous order',
  'Reject weak passwords at registration',
  'Retired products are still visible by id',
  'Tax on multi-line invoices is a cent off',
  'Require a signature for high-value deliveries',
  'Customers can register twice with different case',
  'Customers cannot list their invoices',
  'Replace the notification switch with a table',
  'Line discounts do not add up to the order total',
  'Invoices should show federal and regional tax',
  'Checking out an empty cart creates an order',
  'Free standard shipping on orders over $75',
  'Stock reservations should be all or nothing',
  'Customers want a plain-text copy of their receipt',
  'Carts accept more units than are in stock',
  'Cap the discount a percentage coupon can give',
  'Make product filtering a pure function',
  'Expired coupons are still accepted at checkout',
  'A failed checkout leaves stock reserved',
  'Fixed-amount coupons can push a total below zero',
  'Customers should get a receipt when paid',
  'Finance needs a list of overdue invoices',
];
const LANDINGS = REPLAY_TITLES.length;
const FELL = {
  9: 'Make the invoice payment terms configurable',
  19: 'Wholesale customers should not be charged tax',
  20: 'Customers want to leave delivery notes',
};
const FELL_IDS = ['t006', 't007', 't010'];
const RED_AT = 12;
const DECIDE_AT = 24;

/** The week as a sequence of landings and fall-offs, each with its time. */
const SEQ = [];
for (let n = 0; n < LANDINGS; n++) {
  SEQ.push({ kind: 'land', n, title: REPLAY_TITLES[n] });
  if (FELL[n]) SEQ.push({ kind: 'fell', title: FELL[n] });
}
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
for (const [i, item] of SEQ.entries()) {
  const week = (i + 0.5) / SEQ.length;
  const minutes = Math.round(9 * 60 + ((week * 5) % 1) * 8.7 * 60);
  item.day = DAYS[Math.min(4, Math.floor(week * 5))];
  item.time = `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const esc = (s) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** Everything the frame shows at time t (ms). */
function frameAt(t) {
  const p = clamp01((t - AT.play) / AT.replayMs);
  const k = Math.floor(p * SEQ.length);
  const applied = SEQ.slice(0, k);
  const landed = applied.filter((s) => s.kind === 'land').length;
  const red = landed > RED_AT && landed < RED_AT + 3;
  const stalk = p >= 1 ? landed : Math.floor(landed / 5) * 5;
  let growing = 6;
  if (p >= 1) growing = 0;
  else if (p > 0.86) growing = Math.max(1, Math.round((6 * (1 - p)) / 0.14));
  const last = applied.at(-1);
  return {
    t,
    p,
    k,
    applied,
    landed,
    stalk,
    red,
    growing,
    typed: QUESTION.slice(
      0,
      Math.floor(clamp01((t - AT.type) / (AT.charMs * QUESTION.length)) * QUESTION.length),
    ),
    clock: last ? `${last.day} ${last.time}` : 'Mon 9:00',
    playing: t >= AT.play && t < AT.end,
    finished: t >= AT.end,
  };
}

function beanStatus(f, i) {
  if (f.red && i === 0) return 'reworking';
  const phase = (f.t / 900 + i * 0.45) % 3;
  return phase < 2.1 ? 'checking' : 'writing';
}

function tipBeans(f) {
  return Array.from({ length: f.growing }, (_, i) => {
    const n = f.landed + i;
    return {
      agent: `a${(n * 5) % 12}`,
      title: REPLAY_TITLES[n] ?? 'Customers want saved carts',
      status: beanStatus(f, i),
      secs: Math.floor((f.t / 1000 + i * 17) % 110),
    };
  });
}

function leaf(item, cls, enter) {
  const side = item.n % 2 ? ' l' : '';
  return `<div class="srow ${cls}${side}${enter ? ' enter' : ''}"><span class="tm">${item.time}</span><span class="stem"><i class="lf"></i></span><span class="tt">${esc(item.title)}</span><span class="ix">#${item.n}</span></div>`;
}

/**
 * The stalk's rows. `moment` is the validation that just passed (the batch of sprouts that
 * matured together); `fresh` is true on the frame it passed, when the leaves animate.
 */
function stalkRows(f, prevLanded, moment) {
  const rows = [];
  if (f.finished) {
    rows.push(
      `<div class="tipnote"><span></span><span class="stem"></span><span>Nothing growing. The week is replayed.</span></div>`,
    );
  } else {
    for (const b of tipBeans(f)) {
      const st = { checking: 'check', writing: 'write', reworking: 'sent back' }[b.status];
      rows.push(
        `<div class="srow bean ${b.status}"><span class="ag">${b.agent}</span><span class="stem"><i class="beanmark"></i></span><span class="tt">${esc(b.title)}</span><span class="st">${st}</span></div>`,
      );
    }
  }
  const newestFirst = f.applied.toReversed();
  const sprout = newestFirst.filter((s) => s.kind === 'land' && s.n >= f.stalk);
  for (const s of sprout) {
    rows.push(leaf(s, s.n === RED_AT && f.red ? 'sprout red' : 'sprout', s.n >= prevLanded));
  }
  if (f.stalk > 0) {
    const above = f.landed - f.stalk;
    const bracket = moment
      ? `<div class="matured-row"><span></span><span class="stem"></span><span>validated at ${moment.clock} · ${moment.to - moment.from} matured</span></div>`
      : '';
    const label = above
      ? `stalk at #${f.stalk - 1}, ${above} on the sprout above`
      : `stalk at #${f.stalk - 1}`;
    rows.push(
      `<div class="pointer"><span></span><span class="stem"></span><span>${label}</span></div>`,
      bracket,
    );
  }
  for (const s of newestFirst) {
    if (s.kind === 'fell') {
      rows.push(
        `<div class="srow fell"><span class="tm">${s.time}</span><span class="stem"><i class="fl"></i></span><span class="tt">${esc(s.title)}</span><span class="ix">fell</span></div>`,
      );
    } else if (s.n < f.stalk) {
      const matured = moment?.fresh && s.n >= moment.from && s.n < moment.to;
      rows.push(leaf(s, matured ? 'stalk matured' : 'stalk', s.n >= prevLanded));
    }
  }
  rows.push(
    `<div class="seedrow"><span></span><span class="stem"></span><span>Fertilized by coop</span></div>`,
  );
  return rows.join('');
}

function growRows(f) {
  if (f.finished) {
    return `<div class="g-empty">Nothing growing. ${f.landed} beans landed this week, 3 fell off.</div>`;
  }
  return tipBeans(f)
    .map((b) => {
      const time = `${Math.floor(b.secs / 60)}:${String(b.secs % 60).padStart(2, '0')}`;
      const label = b.status === 'reworking' ? 'back to its author' : `${b.status} ${time}`;
      return `<div class="g-row ${b.status}"><span class="a">${b.agent}</span><span class="t">${esc(b.title)}</span><span class="s"><i class="spin"></i>${label}</span></div>`;
    })
    .join('');
}

function eventRows(f) {
  const events = [];
  const fellCount = f.applied.filter((s) => s.kind === 'fell').length;
  if (fellCount > 0) {
    events.push(
      `<div class="ev"><span class="ic fell">·</span><div><b>${fellCount} bean${fellCount > 1 ? 's' : ''} fell off</b><span>${FELL_IDS.slice(0, fellCount).join(', ')} (conflict)</span></div></div>`,
    );
  }
  if (f.landed > DECIDE_AT) {
    events.push(
      `<div class="ev"><span class="ic decide">◆</span><div><b>D001: two specs clashed</b><span>coop kept "Show thousands separators in displayed amounts". Humans resolve real disagreements.</span></div></div>`,
    );
  }
  if (f.landed > RED_AT) {
    events.push(
      `<div class="ev"><span class="ic red">×</span><div><b>The sprout went red at #${RED_AT}</b><span>tracking-email.test.ts failed. Bisecting named t018 and sent it back to its author; green again 3.4 min later.</span></div></div>`,
    );
  }
  return events.length
    ? events.join('')
    : '<div class="g-empty">Nothing yet. The replay fills this in.</div>';
}

function statusLine(f) {
  const sprout = f.landed ? `#${f.landed - 1}` : 'none';
  const stalk = f.stalk ? `#${f.stalk - 1}` : 'none';
  return [
    `<span><i class="dot ${f.red ? 'red' : 'leaf'}"></i>sprout ${sprout}</span>`,
    `<span><i class="dot leaf"></i>stalk ${stalk}</span>`,
    `<span class="${f.red ? 'red' : ''}">sprout ${f.red ? 'red' : 'green'}</span>`,
    `<span><i class="dot bean"></i>${f.growing} beans growing</span>`,
    `<span class="opt">${f.growing ? `${f.growing} sessions active` : 'no sessions active'}</span>`,
    '<span class="sp"></span>',
    `<span class="opt">${f.playing ? 'replaying' : 'replay'}</span>`,
    `<span>${f.clock}</span>`,
  ].join('');
}

function answerSub(f) {
  if (f.finished) return `Done: ${f.landed} beans landed on the stalk between Monday and Friday.`;
  if (f.playing) return `${f.clock}: ${f.landed} landed so far, 12 agents working.`;
  return 'Press play: 35 beans, 12 agents, Monday to Friday.';
}

function setupAppDemo() {
  const app = document.querySelector('[data-appdemo]');
  if (!app) return;
  const $ = (name) => app.querySelector(`[data-d-${name}]`);
  const el = {
    rows: $('rows'),
    count: $('count'),
    progress: $('progress'),
    clock: $('clock'),
    ask: $('ask'),
    typed: $('typed'),
    ph: $('ph'),
    picked: $('picked'),
    answer: $('answer'),
    sub: $('sub'),
    growbox: $('growbox'),
    grow: $('grow'),
    growhead: $('growhead'),
    eventbox: $('eventbox'),
    events: $('events'),
    evhead: $('evhead'),
    status: $('status'),
  };
  if (Object.values(el).some((node) => !node)) return;
  const caret = el.ask.querySelector('.caret');

  let prevLanded = 0;
  let prevStalk = 0;
  /** The last validation moment: which sprouts matured, and until when it stays marked. */
  let moment = null;
  let prevKey = '';
  const draw = (t) => {
    const f = frameAt(t);
    const key = `${f.typed.length}|${f.k}|${Math.floor(t / 450)}|${f.playing}|${f.finished}|${t >= AT.picked}`;
    if (key === prevKey) return;
    prevKey = key;
    if (f.landed < prevLanded) {
      prevLanded = 0;
      prevStalk = 0;
    }
    el.typed.textContent = f.typed;
    el.ph.hidden = f.typed.length > 0;
    if (caret instanceof HTMLElement) caret.hidden = t >= AT.enter;
    el.ask.classList.toggle('focus', t >= AT.type - 300 && t < AT.enter + 250);
    el.picked.classList.toggle('on', t >= AT.picked);
    el.answer.classList.toggle('on', t >= AT.answer);
    el.growbox.classList.toggle('on', t >= AT.grow);
    el.eventbox.classList.toggle('on', t >= AT.events);
    app.classList.toggle('playing', f.playing);
    el.progress.style.width = `${(f.p * 100).toFixed(1)}%`;
    el.clock.textContent = f.clock;
    el.count.textContent = `${f.landed} landed, ${f.growing} growing`;
    if (f.stalk > prevStalk && prevStalk > 0)
      moment = { from: prevStalk, to: f.stalk, clock: f.clock, until: t + 2600, fresh: true };
    else if (moment)
      moment = t > moment.until || f.stalk < moment.to ? null : { ...moment, fresh: false };
    el.rows.innerHTML = stalkRows(f, prevLanded, moment);
    el.grow.innerHTML = growRows(f);
    el.growhead.textContent = f.growing
      ? `${f.growing} beans checking in parallel`
      : 'the run is quiet';
    el.events.innerHTML = eventRows(f);
    el.status.innerHTML = statusLine(f);
    el.sub.textContent = answerSub(f);
    if (f.stalk > prevStalk) {
      el.rows.classList.add('validating');
      setTimeout(() => el.rows.classList.remove('validating'), 1100);
    }
    prevLanded = f.landed;
    prevStalk = f.stalk;
  };

  const frozen = Number(new URLSearchParams(location.search).get('demo'));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (Number.isFinite(frozen) && frozen > 0) {
    prevLanded = Infinity;
    // Draw the moment just before too, so a validation that passed in between shows as one.
    draw(Math.max(1, frozen - 700));
    prevKey = '';
    draw(frozen);
    return;
  }
  if (reduced.matches) {
    prevLanded = Infinity;
    draw(AT.end + 1);
    return;
  }

  let elapsed = 0;
  let last = 0;
  let raf = 0;
  let visible = false;
  const loop = (now) => {
    if (last) elapsed += Math.min(now - last, 100);
    last = now;
    if (elapsed >= AT.loop) elapsed = 0;
    draw(elapsed);
    raf = requestAnimationFrame(loop);
  };
  const sync = () => {
    const run = visible && !document.hidden && !reduced.matches;
    if (run && !raf) {
      last = 0;
      raf = requestAnimationFrame(loop);
    }
    if (!run && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (reduced.matches) draw(AT.end + 1);
  };
  draw(0);
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    sync();
  }).observe(app);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
}

setupAppDemo();
