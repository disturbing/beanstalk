/*
 * The picker: Jev behind an adapter, with a deterministic fallback.
 *
 * House rule: code computes the candidates, Jev picks among them, nothing writes layout.
 * Every decision the page takes goes through `Picker.decide`, which records a receipt
 * (what was asked, the candidate set, what was chosen, and by whom) so the UI can show
 * exactly where a pick happened.
 *
 * Live mode needs a proxy that holds the TypeSafe key (never the browser): open the page
 * with ?jev=https://your-proxy/v1/systemone. Without it, or when a call fails or takes
 * longer than the budget, the rule written next to each decision answers instead.
 */
(function () {
  const params = new URLSearchParams(location.search);
  const endpoint = params.get('jev');
  const BUDGET_MS = 1200;

  const receipts = [];
  const listeners = new Set();

  const Picker = {
    endpoint,
    status: endpoint
      ? { by: 'jev', note: 'Jev live through ' + new URL(endpoint).host }
      : {
          by: 'rules',
          note: 'Jev is offline (TypeSafe answered 402, no credits, on 4 Oct). Fixed rules pick instead; the candidates and outputs are the same.',
        },
    receipts,
    onReceipt(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /**
     * decision = {
     *   id, title,                 // e.g. 'route', 'Route the question'
     *   ask,                       // the instruction Jev would get
     *   state,                     // compact JSON Jev would see (never file contents)
     *   candidates: [{ id, desc }],
     *   pick: 1 | n,               // how many to choose (ordered)
     *   rule: () => ({ chosen: [ids], why })   // the deterministic fallback
     * }
     */
    async decide(decision) {
      const started = performance.now();
      let out = null;
      if (endpoint) out = await callJev(decision).catch(() => null);
      if (!out) {
        const r = decision.rule();
        out = { chosen: r.chosen, by: 'rules', why: r.why, confidence: null };
      }
      const valid = new Set(decision.candidates.map((c) => c.id));
      out.chosen = out.chosen.filter((id) => valid.has(id));
      if (!out.chosen.length) {
        const r = decision.rule();
        out = {
          chosen: r.chosen,
          by: 'rules',
          why: r.why + ' (Jev answer was not in the catalog)',
          confidence: null,
        };
      }
      const receipt = {
        n: receipts.length + 1,
        id: decision.id,
        title: decision.title,
        ask: decision.ask,
        candidates: decision.candidates,
        chosen: out.chosen,
        by: out.by,
        why: out.why,
        confidence: out.confidence,
        ms: Math.round(performance.now() - started),
        stateBytes: JSON.stringify(decision.state || {}).length,
      };
      receipts.push(receipt);
      listeners.forEach((fn) => fn(receipt));
      return receipt;
    },
  };

  /** One TypeSafe System One call: a Choice per slot (Jev picks one option per question). */
  async function callJev(decision) {
    const criteria = Object.fromEntries(decision.candidates.map((c) => [c.id, c.desc]));
    const n = Math.min(decision.pick || 1, decision.candidates.length);
    const questions = {};
    for (let i = 0; i < n; i++) {
      questions['slot' + i] = {
        type: 'choice',
        instructions:
          decision.ask +
          (n > 1 ? ` Give choice number ${i + 1} of ${n}, different from earlier choices.` : ''),
        criteria,
      };
    }
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), BUDGET_MS);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'jev-latest', state: decision.state, questions }),
        signal: ctl.signal,
      });
      if (!res.ok) return null;
      const body = await res.json();
      const answers = body.answers || body;
      const chosen = [];
      let conf = 1;
      for (let i = 0; i < n; i++) {
        const a = answers['slot' + i];
        const v = a && (a.value ?? a.choice ?? a.answer);
        if (v && !chosen.includes(v)) chosen.push(v);
        if (a && typeof a.confidence === 'number') conf = Math.min(conf, a.confidence);
      }
      return chosen.length ? { chosen, by: 'jev', why: 'Jev choice', confidence: conf } : null;
    } finally {
      clearTimeout(timer);
    }
  }

  window.Picker = Picker;
})();
