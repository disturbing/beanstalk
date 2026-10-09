// The Automations section's builder: an HTML recreation of the real one. The template "Fix red
// beans" is picked, the bean_red chip switched on and the prompt typed, while the YAML beside the
// form follows each change and the live check says what is missing. Save makes a bean, which is
// checked and lands; later a red bean starts the automation, which pushes a fix and writes its
// memory. Every frame is a pure function of the time into the story. Nothing fades: each change
// appears whole. Reduced motion (and no script) shows the finished frame; `?au=<ms>` freezes it.

const AU_TEMPLATE_MS = 900;
const AU_CHIP_MS = 2100;
const AU_TYPE_MS = 3000;
const AU_CHAR_MS = 34;
const AU_PROMPT =
  'Read why the bean went red. Check your memory for this failure. Fix it in a new bean and note what you learned.';
const AU_TYPED_MS = AU_TYPE_MS + AU_PROMPT.length * AU_CHAR_MS;
const AU_SAVE_MS = AU_TYPED_MS + 900;
const AU_LANDED_MS = AU_SAVE_MS + 1800;
const AU_RUN_MS = [
  AU_LANDED_MS + 1500,
  AU_LANDED_MS + 2700,
  AU_LANDED_MS + 4600,
  AU_LANDED_MS + 6000,
];
const AU_END_MS = AU_RUN_MS[3] + 5000;
const AU_WRAP = 40;

/** What the form holds at `t`. */
function auState(t) {
  const typed =
    t < AU_TYPE_MS ? 0 : Math.min(AU_PROMPT.length, Math.floor((t - AU_TYPE_MS) / AU_CHAR_MS));
  return {
    template: t >= AU_TEMPLATE_MS,
    chip: t >= AU_CHIP_MS,
    prompt: AU_PROMPT.slice(0, typed),
    typing: t >= AU_TYPE_MS && t < AU_TYPED_MS,
    saved: t >= AU_SAVE_MS,
    landed: t >= AU_LANDED_MS,
    run: AU_RUN_MS.filter((at) => t >= at).length,
  };
}

/** The prompt as YAML's block lines, wrapped as an editor would show them. */
function auWrap(text) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line === '' ? word : `${line} ${word}`;
    if (next.length > AU_WRAP && line !== '') {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line !== '') lines.push(line);
  return lines;
}

/** Which part of the file the latest step wrote: the prompt, the trigger, or the template. */
function latestChange(state) {
  if (state.prompt !== '') return 'prompt';
  if (state.chip) return 'on';
  return 'tpl';
}

/** The YAML at a state: each line, and whether the latest change made it. */
function auYaml(state) {
  if (!state.template) return [{ text: '# pick a template, or write YAML here', isNew: false }];
  const fresh = state.saved ? null : latestChange(state);
  const lines = [{ text: 'name: Fix red beans', tag: 'tpl' }];
  if (state.chip)
    lines.push(
      { text: 'on:', tag: 'on' },
      { text: '  bean_red:', tag: 'on' },
      { text: "    beans: ['*', '!fix-*']", tag: 'on' },
    );
  lines.push(
    { text: 'harness: agent', tag: 'tpl' },
    { text: 'permissions:', tag: 'tpl' },
    { text: '  beans: write', tag: 'tpl' },
    { text: 'max-cost-usd: 0.50', tag: 'tpl' },
    { text: 'memory: true', tag: 'tpl' },
  );
  if (state.prompt !== '')
    lines.push(
      { text: 'prompt: |', tag: 'prompt' },
      ...auWrap(state.prompt).map((text) => ({ text: `  ${text}`, tag: 'prompt' })),
    );
  return lines.map((line) => ({ text: line.text, isNew: line.tag === fresh }));
}

/** The live check's verdict, as the builder words it. */
function auValidity(state) {
  if (!state.template) return { text: 'empty', ok: false };
  const missing = [state.chip ? null : 'on: a trigger', state.prompt ? null : 'prompt'].filter(
    Boolean,
  );
  return missing.length === 0
    ? { text: '✓ valid', ok: true }
    : { text: `needs ${missing.join(', ')}`, ok: false };
}

function setupAutomationsDemo() {
  const root = document.querySelector('[data-audemo]');
  if (!root) return;
  const $ = (name) => root.querySelector(`[data-au-${name}]`);
  const el = {
    tpl: $('tpl'),
    name: $('name'),
    chip: $('chip'),
    prompt: $('prompt'),
    caret: $('caret'),
    valid: $('valid'),
    save: $('save'),
    status: $('status'),
    phase: $('phase'),
    saved: $('saved'),
    yaml: $('yaml'),
    idle: $('idle'),
    steps: [...root.querySelectorAll('[data-au-step]')],
  };
  let prevYaml = '';

  const draw = (t) => {
    const state = auState(t);
    el.tpl.classList.toggle('on', state.template);
    el.name.textContent = state.template ? 'Fix red beans' : '';
    el.chip.classList.toggle('on', state.chip);
    el.prompt.textContent = state.prompt;
    el.caret.hidden = !state.typing;
    const validity = auValidity(state);
    el.valid.textContent = validity.text;
    el.valid.classList.toggle('off', !validity.ok);
    el.save.classList.toggle('press', state.saved);
    el.status.style.visibility = state.saved ? 'visible' : 'hidden';
    el.phase.textContent = state.landed ? 'landed' : 'checking';
    el.phase.classList.toggle('landed', state.landed);
    el.saved.textContent = state.landed
      ? 'Saved. Live when the stalk takes it.'
      : 'pre-land check on the merged tree';
    const lines = auYaml(state);
    const key = lines.map((line) => `${line.isNew ? '+' : ' '}${line.text}`).join('\n');
    if (key !== prevYaml) {
      prevYaml = key;
      el.yaml.replaceChildren(
        ...lines.map((line) => {
          const span = document.createElement('span');
          span.textContent = line.text;
          if (line.isNew) span.className = 'new';
          return span;
        }),
      );
    }
    el.steps.forEach((step, index) => {
      step.hidden = index >= state.run;
    });
    el.idle.hidden = state.run > 0;
  };

  const frozen = Number(new URLSearchParams(location.search).get('au'));
  if (Number.isFinite(frozen) && frozen > 0) {
    draw(frozen);
    return;
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let t = 0;
  let last = 0;
  let raf = 0;
  let visible = false;
  const loop = (now) => {
    if (last) t = (t + Math.min(now - last, 100)) % AU_END_MS;
    last = now;
    draw(t);
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
    if (reduced.matches) draw(AU_END_MS - 1);
  };
  draw(reduced.matches ? AU_END_MS - 1 : 0);
  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    sync();
  }).observe(root);
  document.addEventListener('visibilitychange', sync);
  reduced.addEventListener('change', sync);
}

setupAutomationsDemo();
