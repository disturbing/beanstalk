"""Human decision cards: a tiny local web page (stdlib ``http.server``) that shows each open card and blocks the
deciding flow until someone clicks a choice, with a timeout fallback to the oracle.

  GET  /                 every card of the run (open ones first); refreshes itself every 3 s
  GET  /card/<id>        one card: both one-line specs, the failing tests, the two diffs, the oracle's suggestion
  POST /card/<id>        form fields ``choice`` (keep-landed | adopt-arriving) and optional ``text`` (a third line)
  GET  /api/cards        the cards as JSON (scripted clicks in tests)

The server runs in a daemon thread; ``ask`` is awaited on the race's event loop and resolved through
``loop.call_soon_threadsafe`` when the click arrives.
"""
from __future__ import annotations

import asyncio
import html
import json
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

CHOICES = ("keep-landed", "adopt-arriving")


class CardBoard:
    def __init__(self, port: int = 8765, host: str = "127.0.0.1"):
        self.host, self.port = host, port
        self.cards: dict[str, dict] = {}
        self.order: list[str] = []
        self.lock = threading.Lock()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.server: ThreadingHTTPServer | None = None
        self.thread: threading.Thread | None = None

    # ---- lifecycle -------------------------------------------------------------------------------------------

    def start(self) -> str:
        """Bind (trying the next ports if busy) and serve in a daemon thread; returns the index URL."""
        self.loop = asyncio.get_running_loop()
        board = self

        class Handler(CardHandler):
            pass
        Handler.board = board
        last: Exception | None = None
        for port in range(self.port, self.port + 20):
            try:
                self.server = ThreadingHTTPServer((self.host, port), Handler)
                self.port = port
                break
            except OSError as e:
                last = e
        if self.server is None:
            raise RuntimeError(f"no free port for the card board from {self.port}: {last}")
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, name="card-board", daemon=True)
        self.thread.start()
        return self.index_url()

    def stop(self) -> None:
        if self.server:
            self.server.shutdown()
            self.server.server_close()
            self.server = None

    def index_url(self) -> str:
        return f"http://{self.host}:{self.port}/"

    def url(self, card: str) -> str:
        return f"http://{self.host}:{self.port}/card/{card}"

    # ---- asking ----------------------------------------------------------------------------------------------

    async def ask(self, view: dict, timeout: float) -> dict | None:
        """Show ``view`` (a card) and wait for a click. Returns {choice, text, wait_seconds} or None on timeout."""
        assert self.loop is not None
        fut: asyncio.Future = self.loop.create_future()
        card = view["card"]
        with self.lock:
            self.cards[card] = {"view": view, "status": "open", "future": fut, "opened": time.monotonic(),
                                "deadline": time.monotonic() + timeout, "answer": None}
            self.order.append(card)
        try:
            return await asyncio.wait_for(asyncio.shield(fut), timeout)
        except asyncio.TimeoutError:
            with self.lock:
                c = self.cards[card]
                if c["status"] == "open":
                    c["status"] = "timed out"
            return None

    def answer(self, card: str, choice: str, text: str) -> str:
        """Called from the HTTP thread. Returns a status message for the page."""
        with self.lock:
            c = self.cards.get(card)
            if c is None:
                return "unknown card"
            if c["status"] != "open":
                return f"this card is already {c['status']}"
            if choice not in CHOICES:
                return f"unknown choice {choice!r}"
            c["status"] = "decided"
            c["answer"] = {"choice": choice, "text": text.strip(),
                           "wait_seconds": round(time.monotonic() - c["opened"], 2)}
            fut = c["future"]
        assert self.loop is not None
        self.loop.call_soon_threadsafe(lambda: fut.done() or fut.set_result(c["answer"]))
        return "decided"

    def note(self, card: str, **fields) -> None:
        """Record what happened after the decision (shown on the card page)."""
        with self.lock:
            if card in self.cards:
                self.cards[card].setdefault("notes", []).append(fields)

    def snapshot(self) -> list[dict]:
        with self.lock:
            out = []
            for cid in self.order:
                c = self.cards[cid]
                out.append({"card": cid, "status": c["status"], "answer": c["answer"],
                            "seconds_left": max(0, round(c["deadline"] - time.monotonic())),
                            "notes": c.get("notes", []), **{k: v for k, v in c["view"].items() if k != "card"}})
            return out


# ---- HTML ----------------------------------------------------------------------------------------------------------

STYLE = """
:root{--bg:#f7f6f2;--fg:#1d1d1b;--muted:#6b6a64;--card:#fff;--line:#dedcd3;--accent:#2f6b3a;--warn:#9a4b16}
@media (prefers-color-scheme: dark){:root{--bg:#191917;--fg:#ecebe6;--muted:#a3a29b;--card:#23231f;--line:#3a3a34;
--accent:#7fc28a;--warn:#e0a070}}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto} h1{font-size:20px;margin:4px 0 12px} h2{font-size:16px;margin:16px 0 6px}
.muted{color:var(--muted)} .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:760px){.grid{grid-template-columns:1fr}}
.box{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:12px;min-width:0}
.spec{font-size:16px;font-weight:600;margin:4px 0 8px} pre{overflow:auto;max-height:420px;font-size:12px;
background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:8px;white-space:pre}
button{font:inherit;padding:10px 14px;border-radius:8px;border:1px solid var(--line);background:var(--card);
color:var(--fg);cursor:pointer;margin:4px 8px 4px 0} button.rec{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
textarea{width:100%;box-sizing:border-box;min-height:60px;font:inherit;background:var(--card);color:var(--fg);
border:1px solid var(--line);border-radius:6px;padding:6px} a{color:var(--accent)} table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid var(--line);padding:6px;text-align:left;vertical-align:top}
.tag{display:inline-block;padding:1px 6px;border-radius:10px;border:1px solid var(--line);font-size:12px}
.open{color:var(--warn);border-color:var(--warn)} ul{margin:4px 0;padding-left:18px}
"""


def page(title: str, body: str, refresh: int | None = None) -> bytes:
    meta = f'<meta http-equiv="refresh" content="{refresh}">' if refresh else ""
    return (f"<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' "
            f"content='width=device-width,initial-scale=1'>{meta}<title>{html.escape(title)}</title>"
            f"<style>{STYLE}</style></head><body><main>{body}</main></body></html>").encode("utf-8")


def e(x) -> str:
    return html.escape(str(x if x is not None else ""))


def render_index(cards: list[dict]) -> bytes:
    rows = []
    for c in sorted(cards, key=lambda c: (c["status"] != "open", c["card"])):
        cls = "tag open" if c["status"] == "open" else "tag"
        ans = c.get("answer") or {}
        rows.append(f"<tr><td><a href='/card/{e(c['card'])}'>{e(c['card'])}</a></td>"
                    f"<td>{e(c['arriving'])} meets {e(c['landed'])}</td><td>{e(c['trigger'])}</td>"
                    f"<td><span class='{cls}'>{e(c['status'])}</span></td><td>{e(ans.get('choice', ''))}</td></tr>")
    body = ("<h1>Beanstalk decision cards</h1><p class='muted'>Two beans' specs contradict. You decide the meaning; "
            "the losing bean is re-executed under the winning spec. Open cards wait for a click and fall back to "
            "the oracle when their timer runs out.</p>")
    if rows:
        body += ("<table><tr><th>Card</th><th>Pair</th><th>Trigger</th><th>Status</th><th>Choice</th></tr>"
                 + "".join(rows) + "</table>")
    else:
        body += "<p>No cards yet. This page refreshes every 3 seconds.</p>"
    return page("Decision cards", body, refresh=3)


def render_card(c: dict, message: str = "") -> bytes:
    landed, arriving = c["landed"], c["arriving"]
    specs, titles, diffs = c.get("specs", {}), c.get("titles", {}), c.get("diffs", {})
    rec = c.get("recommended", "")
    rec_choice = "keep-landed" if rec == landed else "adopt-arriving"

    def side(tid: str, role: str) -> str:
        return (f"<div class='box'><div class='muted'>{e(role)} · {e(tid)} · {e(titles.get(tid, ''))}</div>"
                f"<div class='spec'>{e(specs.get(tid, ''))}</div><pre>{e(diffs.get(tid) or '(no diff)')}</pre></div>")
    failing = "".join(f"<li>{e(f)}</li>" for f in c.get("failing", [])) or "<li class='muted'>none yet: raised at start, " \
                                                                           "before the arriving bean ran</li>"
    status = c["status"]
    body = (f"<p><a href='/'>All cards</a></p><h1>{e(c['card'])} · {e(arriving)} meets {e(landed)}</h1>"
            f"<p class='muted'>Trigger: {e(c['trigger'])} · coupling: {e(c.get('source', ''))}"
            f"{' (declared)' if c.get('known') else ''} · status: <b>{e(status)}</b>"
            + (f" · {c['seconds_left']} s left before the oracle answers" if status == 'open' else "") + "</p>")
    if c.get("note"):
        body += f"<p>{e(c['note'])}</p>"
    body += f"<div class='grid'>{side(landed, 'Landed on the sprout')}{side(arriving, 'Arriving')}</div>"
    body += f"<h2>Failing tests</h2><ul>{failing}</ul>"
    if c.get("output"):
        body += f"<pre>{e(c['output'])}</pre>"
    if status == "open":
        body += (f"<h2>Decide</h2><p class='muted'>Oracle suggestion: {e(rec)} wins ({e(c.get('oracle', ''))}).</p>"
                 f"<form method='post' action='/card/{e(c['card'])}'>"
                 f"<button name='choice' value='keep-landed' class='{'rec' if rec_choice == 'keep-landed' else ''}'>"
                 f"Keep landed: {e(landed)} wins, {e(arriving)} adapts</button>"
                 f"<button name='choice' value='adopt-arriving' class='{'rec' if rec_choice == 'adopt-arriving' else ''}'>"
                 f"Adopt arriving: {e(arriving)} wins, {e(landed)} is reverted and re-executed</button>"
                 "<p class='muted'>Optional decision text (a third line the loser and the test author will read):</p>"
                 "<textarea name='text'></textarea></form>")
    else:
        ans = c.get("answer") or {}
        body += f"<h2>Decision</h2><p>{e(ans.get('choice', 'oracle fallback'))} {e(ans.get('text', ''))}</p>"
        for n in c.get("notes", []):
            body += f"<p class='muted'>{e(json.dumps(n))}</p>"
    if message:
        body += f"<p><b>{e(message)}</b></p>"
    return page(f"{c['card']} decision card", body, refresh=None if status == "open" else 5)


class CardHandler(BaseHTTPRequestHandler):
    board: CardBoard

    def log_message(self, fmt, *args) -> None:  # keep the race's stdout clean
        pass

    def send(self, body: bytes, status: int = 200, ctype: str = "text/html; charset=utf-8") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def find(self, cid: str) -> dict | None:
        return next((c for c in self.board.snapshot() if c["card"] == cid), None)

    def do_GET(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if path in ("/", "/index.html"):
            return self.send(render_index(self.board.snapshot()))
        if path == "/api/cards":
            return self.send(json.dumps(self.board.snapshot(), default=str).encode(), ctype="application/json")
        if path.startswith("/card/"):
            c = self.find(path.split("/")[2])
            return self.send(render_card(c)) if c else self.send(page("Not found", "<p>No such card.</p>"), 404)
        self.send(page("Not found", "<p>Not found.</p>"), 404)

    def do_POST(self) -> None:
        path = urllib.parse.urlparse(self.path).path
        if not path.startswith("/card/"):
            return self.send(page("Not found", "<p>Not found.</p>"), 404)
        cid = path.split("/")[2]
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n).decode("utf-8", errors="replace") if n else ""
        if (self.headers.get("Content-Type") or "").startswith("application/json"):
            form = json.loads(raw or "{}")
        else:
            form = {k: v[0] for k, v in urllib.parse.parse_qs(raw).items()}
        msg = self.board.answer(cid, str(form.get("choice", "")), str(form.get("text", "")))
        c = self.find(cid)
        if (self.headers.get("Accept") or "").startswith("application/json"):
            return self.send(json.dumps({"result": msg}).encode(), ctype="application/json")
        self.send(render_card(c, msg) if c else page("Not found", "<p>No such card.</p>"))
