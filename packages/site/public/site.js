// Beanstalk marketing site: theme toggle, the sign-up choice, install blocks with copy
// buttons, the animated stalk, and the placeholder human sign-up form. No framework.

// ---------------------------------------------------------------------------
// Install commands. PLACEHOLDERS (owner to confirm): the plugin marketplace repo, the
// plugin and marketplace names, and the MCP origin. They mirror the xinf
// bootstrap: add the marketplace, install the plugin, then the client's own MCP login,
// which opens the browser sign-in.
// ---------------------------------------------------------------------------
const PLUGIN_REPO = 'beanstalkdev/beanstalk-plugin';
const PLUGIN = 'beanstalk';
const MARKETPLACE = 'beanstalk';
const MCP_URL = 'https://mcp.beanstalk.dev/mcp';
const CLAUDE_SERVER = `plugin:${PLUGIN}:${PLUGIN}`;

const INSTALLS = [
  {
    name: 'Claude Code',
    where: 'paste in your terminal',
    kind: 'shell',
    code: `claude plugin marketplace add ${PLUGIN_REPO} && claude plugin install ${PLUGIN}@${MARKETPLACE} && claude mcp login ${CLAUDE_SERVER}`,
    after: `Your browser opens once: sign in (or create your account) and approve this session. Back in Claude Code, the Beanstalk tools and skill are ready. Already inside a session? Type <code>/plugin marketplace add ${PLUGIN_REPO}</code>, then <code>/plugin install ${PLUGIN}@${MARKETPLACE}</code>, then <code>/mcp</code> to sign in.`,
  },
  {
    name: 'Codex',
    where: 'paste in your terminal',
    kind: 'shell',
    code: `codex plugin marketplace add ${PLUGIN_REPO} && codex plugin add ${PLUGIN}@${MARKETPLACE} && codex mcp login ${PLUGIN}`,
    after:
      'The last step opens your browser: sign in and approve this session. Codex then has the Beanstalk tools and skill, and the session joins your team as yours.',
  },
  {
    name: 'Other MCP clients',
    where: 'Cursor, Gemini CLI, Claude Desktop and others: add a remote MCP server',
    kind: 'url',
    code: MCP_URL,
    after:
      'Add this URL as a remote (HTTP) MCP server. The first call opens the same browser sign-in; approve it and your client is connected.',
  },
];

// ---------------------------------------------------------------------------
// Theme: follows the system until the toggle is used, then remembers the choice.
// The inline script in <head> sets the first value so the page never flashes.
// ---------------------------------------------------------------------------
const THEME_KEY = 'beanstalk-theme';
const root = document.documentElement;
const systemDark = matchMedia('(prefers-color-scheme: dark)');

function readStoredTheme() {
  try {
    return localStorage.getItem(THEME_KEY);
  } catch {
    return null;
  }
}

function storeTheme(theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage refused (private window): the choice lasts for this page only.
  }
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
    const next = theme === 'dark' ? 'day' : 'night';
    btn.setAttribute('aria-label', `Switch to ${next} mode`);
    btn.title = `Switch to ${next} mode`;
  }
}

function setupTheme() {
  applyTheme(root.dataset.theme === 'light' ? 'light' : 'dark');
  for (const btn of document.querySelectorAll('[data-theme-toggle]')) {
    btn.addEventListener('click', () => {
      const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      storeTheme(theme);
      applyTheme(theme);
    });
  }
  systemDark.addEventListener('change', (event) => {
    if (!readStoredTheme()) applyTheme(event.matches ? 'dark' : 'light');
  });
}

// ---------------------------------------------------------------------------
// Sign-up choice: every [data-signup] link opens it (without JS the link goes to the agent page).
// ---------------------------------------------------------------------------
const CHOOSE_HTML = `
<dialog class="choose" id="choose" aria-labelledby="choose-title">
  <div class="inner">
    <button type="button" class="close" data-close aria-label="Close">×</button>
    <h2 id="choose-title">Sign up for Beanstalk</h2>
    <p class="sub">Beanstalk is built for agents. Most people sign up from the agent they already use.</p>
    <div class="options">
      <a class="option agent" href="agent.html" autofocus>
        <span class="tag">recommended</span>
        <b>Sign up with Agent</b>
        <span>Paste one command into Claude Code, Codex or another MCP client. It installs the plugin and signs you in.</span>
      </a>
      <a class="option" href="human.html">
        <b>Sign up as Human</b>
        <span>Leave your email and we will send you a sign-in link.</span>
      </a>
    </div>
  </div>
</dialog>`;

function setupSignup() {
  const triggers = document.querySelectorAll('[data-signup]');
  if (triggers.length === 0) return;
  document.body.insertAdjacentHTML('beforeend', CHOOSE_HTML);
  const dialog = document.getElementById('choose');
  if (!(dialog instanceof HTMLDialogElement) || typeof dialog.showModal !== 'function') return;
  for (const trigger of triggers) {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      dialog.showModal();
    });
  }
  dialog.querySelector('[data-close]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  // A shareable link straight to the choice: /#signup
  if (location.hash === '#signup') dialog.showModal();
}

// ---------------------------------------------------------------------------
// Install blocks and copy buttons.
// ---------------------------------------------------------------------------
function escapeHtml(text) {
  return text.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c],
  );
}

function renderInstalls() {
  for (const host of document.querySelectorAll('[data-installs]')) {
    host.innerHTML = INSTALLS.map(
      (item, i) => `
      <article class="cmd">
        <header>
          <b>${item.name}</b>
          <span class="where">${item.where}</span>
          <button type="button" class="btn small copy" data-copy="#cmd-${host.id}-${i}">Copy</button>
        </header>
        <pre class="${item.kind}" id="cmd-${host.id}-${i}" tabindex="0"><code>${escapeHtml(item.code)}</code></pre>
        <p class="copyhint" hidden role="status"></p>
        <p class="after">${item.after}</p>
      </article>`,
    ).join('');
  }
}

function selectText(element) {
  const range = document.createRange();
  range.selectNodeContents(element);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function showCopyState(button, state, label) {
  button.dataset.state = state;
  button.textContent = label;
  const hint = button.closest('.cmd')?.querySelector('.copyhint');
  if (hint) {
    hint.hidden = state !== 'manual';
    hint.textContent =
      state === 'manual'
        ? 'Copying was blocked. The command is selected: press Ctrl+C (⌘C on a Mac).'
        : '';
  }
  if (state === 'done') {
    setTimeout(() => {
      button.dataset.state = '';
      button.textContent = 'Copy';
    }, 2000);
  }
}

async function copyFrom(button) {
  const target = document.querySelector(button.dataset.copy);
  if (!target) return;
  const text = target.textContent.trim();
  try {
    if (!navigator.clipboard) throw new Error('Clipboard API unavailable');
    await navigator.clipboard.writeText(text);
    showCopyState(button, 'done', 'Copied');
  } catch {
    // Clipboard refused (permissions, insecure origin, file://): select the text instead.
    target.focus();
    selectText(target);
    showCopyState(button, 'manual', 'Press Ctrl+C');
  }
}

function setupCopy() {
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('[data-copy]') : null;
    if (button instanceof HTMLElement) void copyFrom(button);
  });
}

// ---------------------------------------------------------------------------
// The animated stalk: beans at the tip are written, checked on the exact tree, and land
// on the sprout; a validated sprout leaf is promoted to the stalk with a pulse of light.
// ---------------------------------------------------------------------------
const TITLES = [
  'Expired coupons are still accepted at checkout',
  'Cap the discount a percentage coupon gives',
  'Carts accept more units than are in stock',
  'Make product filtering a pure function',
  'Customers want a plain-text copy of their receipt',
  'Stock reservations should be all or nothing',
  'Free standard shipping on orders over $50',
  'Invoices should show federal and regional tax',
  'Fixed-amount coupons can push a total below zero',
  'Finance needs a list of overdue invoices',
  'Support refunding a single invoice line',
  'A failed checkout leaves stock reserved',
  'Send a receipt when an invoice is paid',
  'Reject weak passwords at registration',
  'Let customers reorder a previous order',
  'Shipping emails should include the tracking link',
];

function createStalkModel() {
  let titleIx = 0;
  let agentIx = 0;
  let minutes = 12 * 60 + 22;
  const nextTitle = () => TITLES[titleIx++ % TITLES.length];
  const nextAgent = () => `a${agentIx++ % 12}`;
  const clock = () => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;

  const stalk = [];
  for (let n = 25; n > 18; n--) {
    stalk.push({ n, title: nextTitle(), time: clock() });
    minutes -= 9;
  }
  minutes = 12 * 60 + 31;
  const sprout = [{ n: 26, title: nextTitle(), time: clock() }];
  const beans = [
    { agent: nextAgent(), title: nextTitle(), status: 'writing', reworked: false },
    { agent: nextAgent(), title: nextTitle(), status: 'checking', reworked: true },
    { agent: nextAgent(), title: nextTitle(), status: 'writing', reworked: false },
  ];
  let nextN = 27;
  let checks = 0;

  return {
    stalk,
    sprout,
    beans,
    /** One step of the run; returns true when a promotion should send a pulse up the stalk. */
    step() {
      for (const bean of beans) {
        if (bean.status === 'reworking') bean.status = 'writing';
      }
      if (sprout.length >= 3) {
        const leaf = sprout.pop();
        stalk.unshift({ ...leaf, promoted: true });
        stalk.length = Math.min(stalk.length, 9);
        return true;
      }
      const checking = beans.findIndex((b) => b.status === 'checking');
      if (checking >= 0) {
        const bean = beans[checking];
        checks += 1;
        if (!bean.reworked && checks % 4 === 0) {
          // A red check: back to the agent that wrote it, with context.
          bean.status = 'reworking';
          bean.reworked = true;
          return false;
        }
        minutes += 3;
        sprout.unshift({ n: nextN++, title: bean.title, time: clock(), enter: true });
        beans.splice(checking, 1);
        beans.unshift({
          agent: nextAgent(),
          title: nextTitle(),
          status: 'writing',
          reworked: false,
          enter: true,
        });
        return false;
      }
      const writing = beans.findLastIndex((b) => b.status === 'writing');
      if (writing >= 0) beans[writing].status = 'checking';
      return false;
    },
  };
}

const STATUS_SHORT = { writing: 'write', checking: 'check', reworking: 'red' };

function leafRow(leaf, cls) {
  return `<div class="srow ${cls}${leaf.n % 2 ? ' l' : ''}${leaf.enter ? ' enter' : ''}${leaf.promoted ? ' promoted' : ''}">
      <span class="tm">${leaf.time}</span><span class="stem"><i class="lf"></i></span>
      <span class="tt">${escapeHtml(leaf.title)}</span><span class="ix">#${leaf.n}</span></div>`;
}

function renderStalk(model, rowsEl, headEl) {
  const beanRows = model.beans.map(
    (b) => `<div class="srow bean ${b.status}${b.enter ? ' enter' : ''}">
      <span class="ag">${b.agent}</span><span class="stem"><i class="beanmark"></i></span>
      <span class="tt">${escapeHtml(b.title)}</span><span class="st">${STATUS_SHORT[b.status]}</span></div>`,
  );
  const sproutRows = model.sprout.map((leaf) => leafRow(leaf, 'sprout'));
  const top = model.stalk[0];
  const pointer = `<div class="pointer"><span></span><span class="stem"></span><span>stalk at #${top.n}</span></div>`;
  const stalkRows = model.stalk.map((leaf) => leafRow(leaf, 'stalk'));
  rowsEl.innerHTML = [...beanRows, ...sproutRows, pointer, ...stalkRows].join('');
  headEl.textContent = `${model.beans.length} beans growing, ${model.sprout.length} on the sprout`;
  for (const item of [...model.beans, ...model.sprout, ...model.stalk]) {
    item.enter = false;
    item.promoted = false;
  }
  const live = model.beans.find((b) => b.status === 'reworking');
  rowsEl.setAttribute(
    'aria-label',
    live
      ? `${live.agent}'s bean went red and is back with its agent`
      : `Stalk at #${top.n}; ${model.sprout.length} on the sprout; ${model.beans.length} beans growing`,
  );
}

function setupStalk() {
  const host = document.querySelector('[data-stalkdemo]');
  if (!host) return;
  const rowsEl = host.querySelector('.rows');
  const headEl = host.querySelector('[data-stalkhead]');
  if (!rowsEl || !headEl) return;
  const model = createStalkModel();
  renderStalk(model, rowsEl, headEl);

  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let timer = 0;
  let visible = false;
  const tick = () => {
    const pulse = model.step();
    renderStalk(model, rowsEl, headEl);
    rowsEl.classList.toggle('validating', pulse);
  };
  const sync = () => {
    const run = visible && !document.hidden && !reduced.matches;
    if (run && !timer) timer = setInterval(tick, 1700);
    if (!run && timer) {
      clearInterval(timer);
      timer = 0;
    }
  };
  new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    sync();
  }).observe(host);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
}

// ---------------------------------------------------------------------------
// Human sign-up: a placeholder form. There is no backend yet; it only confirms in the page.
// ---------------------------------------------------------------------------
function setupHumanForm() {
  const form = document.querySelector('[data-human-form]');
  if (!(form instanceof HTMLFormElement)) return;
  const input = form.querySelector('input[type="email"]');
  const error = form.querySelector('.err');
  const done = document.querySelector('[data-human-done]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!(input instanceof HTMLInputElement) || !error || !done) return;
    if (!input.checkValidity()) {
      error.hidden = false;
      error.textContent = 'Enter an email address like you@example.com.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    input.removeAttribute('aria-invalid');
    error.hidden = true;
    const target = done.querySelector('[data-email]');
    if (target) target.textContent = input.value.trim();
    form.hidden = true;
    done.hidden = false;
    done.focus();
  });
}

// The proof tally: 37 shipped of 40.
function renderTally() {
  for (const host of document.querySelectorAll('[data-tally]')) {
    host.innerHTML = Array.from({ length: 40 }, (_, i) =>
      i < 37 ? '<i></i>' : '<i class="miss"></i>',
    ).join('');
  }
}

setupTheme();
setupSignup();
renderTally();
renderInstalls();
setupCopy();
setupStalk();
setupHumanForm();
