# beanstalk-swarm

Phase 1 of the cloud agent swarm (`docs/claude-opus/17-cloud-agent-swarm.md`): race agents run in Cloudflare containers instead of on a laptop, one container per gateway slot, and the containers hold no secret. Research tooling for the measured races; it is not part of the demo's request path.

```
laptop: race.py --forge cloudflare --swarm URL      beanstalk-swarm (this Worker)                     beanstalk-gateway
  create run, seed (as remote.py does)  ──────────▶ POST /v1/matches ─▶ MatchDO ─▶ AgentSandbox × N
  wait for "ready", start the run, release ───────▶ (start barrier: every container said hello)
  wait for the gateway's done, download     container: python3 -m harness.slot (Codex CLI 0.160.1)
                                              control.internal ─▶ MatchDO (config, logs, files, exit)
                                              bs.internal      ─▶ GATEWAY service binding, slot token added ─▶ RunDO, git proxy
                                              model.internal   ─▶ api.openai.com (API key added) or
                                                                  chatgpt.com/backend-api/codex (leased seat's token added)
                                              anything else    ─▶ does not resolve (enableInternet = false)
```

## Pieces

| Piece | What it owns |
|---|---|
| `MatchDO` (`src/match/`) | One per match: the slots' config, the start barrier (all hellos, then one release), the spend cap (agent spend from the slots' progress/result posts plus container cost at the upper bound), halt, the slots' `driver.jsonl` lines and shipped files |
| `BrokerDO` (`src/broker/`) | One (`broker`): leased ChatGPT seats encrypted under `SEAT_KEY` (AES-256-GCM), one lease holder per seat, refresh of seats made for the swarm; the swarm-wide halt switch; live matches |
| `AgentSandbox` (`src/agent/`) | One container per slot (`agent/Dockerfile`: Debian trixie, Node 24, Python 3, git, Mergiraf, Codex CLI 0.160.1, `research/race/harness`, the arena). Stores its slot token; the outbound handlers in `virtual-hosts.ts` serve the three virtual hosts |
| `research/race/harness/slot.py` | The in-container driver: `RemoteRace`'s slot loop, unchanged, for one slot; the arena from the image, checked against the race's arena digest |
| `research/race/harness/swarm.py` | The laptop side (`race.py --swarm`): creates and seeds the run, hands the slot tokens to a match, starts the run when every container is up, downloads the run plus `work/driver-swarm.jsonl`, `work/transcripts/<slot>/` and `swarm.json` |

## Credentials (no container ever holds one)

- **Slot tokens**: `POST /v1/matches` hands them to the swarm; each `AgentSandbox` keeps its own. The `bs.internal` handler adds it to every gateway request (the slot sends a placeholder) and takes refreshed tokens out of `next` answers. Allowed routes: the slot's own `next`, its run's `invocations/*/{result,progress,stream}`, and `/git/*`; everything else is 403.
- **`api-key` mode** (default for measured races): the Worker secret `OPENAI_API_KEY`; the `model.internal` handler replaces the container's placeholder bearer with it and forwards `/v1/*` to `MODEL_UPSTREAM` (api.openai.com, or an AI Gateway URL).
- **`lease` mode** (one agent, Coop's ChatGPT subscription): a seat (`auth.json`) stored in the BrokerDO by `scripts/seed-seat.sh`, which Coop runs himself. The container gets a placeholder `auth.json` with made-up tokens; Codex sends them to `model.internal` (custom provider, `requires_openai_auth = true`), and the handler replaces them with the seat's access token and account id for the lease holder only, then forwards to `chatgpt.com/backend-api/codex`. This is stricter than doc 17's lease (real `auth.json` written into the container and read back): here the login never enters a container, and refreshed tokens are written back by the broker itself. A seat made by the script's default (a fresh `codex login` into a throwaway `CODEX_HOME`) is its own session, so the broker may refresh it (`refreshable=1`) without logging the laptop out (rotation is per login session; not verified against OpenAI's docs). `--from-home` uploads the laptop's own `~/.codex/auth.json` as `refreshable=0`: never refreshed, usable until its access token expires.
- `GATEWAY_ADMIN_TOKEN` (optional secret) lets a match re-issue slot tokens after a 401 and stop the gateway run on a halt; without it the laptop driver stops the run, as today.

## Verified (2026-10-07)

- **Codex through a custom base URL**: codex-cli 0.160.1 accepts a plain-HTTP custom provider. With `env_key` it streams `POST <base>/responses` with `Authorization: Bearer <env value>`; with `requires_openai_auth = true` and a ChatGPT `auth.json` it sends the access token plus `chatgpt-account-id` to `<base>/responses` and `GET <base>/models` (local stub, no credential).
- **Codex through the outbound handler, in a container**: both paths reach the real upstream and back. With a placeholder key OpenAI answers `401 Incorrect API key` (`research/race/runs/cf-swarm-codex-probe-apikey/net-diag.txt`); with a fake seat chatgpt.com answers `401 Could not parse your authentication token` (`research/race/runs/cf-swarm-codex-probe-lease/net-diag.txt`). Only authentication is left unverified, which needs a real key or seat.
- **Replay race, Gitstalk arm, slots in containers**: `runs/cf-swarm-replay-v2-4-s7` (4 agents, 12 tasks, demo preset): 10 green, 2 dropped (replay limitations), final check correct, 2.41 min. Laptop control on the same gateway: `runs/cf-laptop-replay-v2-4-s7`, 9 green, 3 dropped, 2.04 min. Not decision-identical (replay races are timing-dependent); per-invocation driver steps are as fast or faster from containers (prepare 2.3 s vs 2.7 s, commit+push 1.3 s vs 2.0 s median).
- **Codex's sandbox works in the container**: `codex sandbox -c sandbox_mode="workspace-write" -- sh -c …` exits 0 on Cloudflare's Firecracker runtime (bubblewrap has user namespaces there; it does not under Docker Desktop), so agents keep `-s workspace-write` with network off for their commands (`research/race/runs/cf-swarm-diag-sandbox/net-diag.txt`).
- **Cold start** (start request to the driver's hello): first start of a new image 10–21 s (median 13.4 s, 4 containers); warm 3.6–4.8 s.
- **Cost**: `standard-3` is $0.000021/s provisioned (memory + disk), $0.000061/s with both vCPUs busy, so $0.08–0.22 per agent-hour; the replay race used 673 container-s ($0.014–0.041).

## Run

```bash
CLOUDFLARE_ACCOUNT_ID=<id> node packages/swarm/scripts/deploy.mjs   # Worker + image; generates .dev.vars secrets
cd research/race
SWARM=https://beanstalk-swarm.<subdomain>.workers.dev
python3 race.py --forge cloudflare --gateway $GW --swarm $SWARM --policy beanstalk-v2 --agent replay --agents 4 \
  --tasks 12 --ci-seconds 4.5 --ci-slots 2 --seed 7 --replay-median 6 --preland-mode optimistic \
  --preland-seconds 4.5 --decision-seconds 1 --preset demo --max-usd 3 --out runs/cf-swarm-replay-v2-4-s7
# Codex: add --agent codex --swarm-credential api-key (or lease --agents 1 --swarm-seat default)
# SWARM_DIAGNOSE=1 makes each slot ship net-diag.txt (resolver, virtual hosts, one codex call, codex's sandbox)
```

- Admin token: `$SWARM_ADMIN_TOKEN`, else `SWARM_ADMIN_TOKEN` in `packages/swarm/.dev.vars`; never printed.
- Halt everything: `POST /v1/admin/halt {"reason": "..."}` (refuses new matches until `POST /v1/admin/resume`); one match: `POST /v1/matches/<id>/halt`.
- Deploys: a new image used to roll out to running containers and stop them (SIGTERM) within a minute or two; `rollout_active_grace_period` (3600 s) now lets running agents finish first. A container started right after a deploy may still run the previous image: the hello's `harness` digest in `swarm.json` says which.
- Placement: the containers seen so far ran in `sin02`; latency to the gateway's Durable Objects is part of the forge time each invocation logs.

## Not yet

The GitHub arm (`GitHubArmDO`), webhooks, paired matches and the quota governor's freeze-and-void (doc 17 phases 2–3); the swarm runs one gateway run per match.
