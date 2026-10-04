"""Stand-in for Coop during a human-mode verification run: click some cards, leave the rest to the timeout.

usage: python3 click_bot.py PORT [choices...]   e.g. click_bot.py 8765 keep-landed adopt-arriving
Clicks the n-th open card with the n-th choice; prints one line per click. Exits after all choices are used or
after 40 minutes.
"""
import json
import sys
import time
import urllib.request

port = int(sys.argv[1])
choices = sys.argv[2:] or ["keep-landed"]
base = f"http://127.0.0.1:{port}"
seen: set[str] = set()
deadline = time.time() + 2400
while choices and time.time() < deadline:
    try:
        cards = json.load(urllib.request.urlopen(base + "/api/cards", timeout=3))
    except OSError:
        time.sleep(2)
        continue
    for c in cards:
        if c["status"] != "open" or c["card"] in seen:
            continue
        seen.add(c["card"])
        choice = choices.pop(0)
        time.sleep(8)  # a human reads the card first
        req = urllib.request.Request(base + f"/card/{c['card']}", data=json.dumps({"choice": choice}).encode(),
                                     headers={"Content-Type": "application/json", "Accept": "application/json"})
        res = json.load(urllib.request.urlopen(req, timeout=5))
        print(f"{time.strftime('%H:%M:%S')} clicked {choice} on {c['card']} ({c['arriving']} meets {c['landed']}, "
              f"{c['trigger']}): {res}", flush=True)
        if not choices:
            break
    time.sleep(2)
