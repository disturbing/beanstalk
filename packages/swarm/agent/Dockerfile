# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed
# The swarm's agent image: one container per agent slot (docs/claude-opus/17 §3.2).
# Codex CLI pinned to the version the measured laptop races use, the race driver in single-slot
# mode (research/race/harness, `python3 -m harness.slot`), the arena's tasks and reference
# patches (checked against the race's arena digest at start), git, Node for the arena's suite,
# and Mergiraf for the driver's structural merge tier. No credential is baked in or passed in:
# the container reaches the model, the gateway and the swarm only through virtual hosts whose
# Worker-side handlers add credentials (packages/swarm/src/agent/virtual-hosts.ts).
#
# The build context is the repo root (wrangler.jsonc image_build_context "../.."); the repo's
# .dockerignore excludes research/, so Dockerfile.dockerignore next to this file (BuildKit's
# per-Dockerfile ignore file) lets in exactly the driver and the arena.
#   docker buildx build --platform linux/amd64 -f packages/swarm/agent/Dockerfile .

ARG DEBIAN_RELEASE=trixie

FROM --platform=$BUILDPLATFORM debian:${DEBIAN_RELEASE}-slim AS tools
ARG MERGIRAF_VERSION=0.20.0
# Upstream publishes no checksums; the release asset's SHA-256 as the runner image pins it.
ARG MERGIRAF_SHA256=4341127da8d1da29eced669fbacc1e5d6e530115098de0b82cc9dc551a1acf37
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /tools
RUN curl -fsSLo mergiraf.tar.gz "https://codeberg.org/mergiraf/mergiraf/releases/download/v${MERGIRAF_VERSION}/mergiraf_x86_64-unknown-linux-gnu.tar.gz" \
 && echo "${MERGIRAF_SHA256}  mergiraf.tar.gz" | sha256sum -c - \
 && tar -xzf mergiraf.tar.gz mergiraf \
 && rm mergiraf.tar.gz

FROM --platform=linux/amd64 node:24-trixie-slim
ARG CODEX_VERSION=0.160.1
RUN apt-get update \
 && apt-get install -y --no-install-recommends git python3 procps tini ca-certificates bubblewrap \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g --no-fund --no-audit "@openai/codex@${CODEX_VERSION}" \
 && npm cache clean --force \
 && codex --version \
 && useradd --uid 10001 --create-home --home-dir /home/agent --shell /usr/sbin/nologin agent \
 && install -d -o agent -g agent /work /home/agent/.codex
COPY --from=tools /tools/mergiraf /usr/local/bin/mergiraf
COPY research/common /opt/beanstalk/research/common
COPY research/arena/tasks /opt/beanstalk/research/arena/tasks
COPY research/arena/solutions /opt/beanstalk/research/arena/solutions
COPY research/race/harness /opt/beanstalk/research/race/harness
USER agent
WORKDIR /opt/beanstalk/research/race
# CODEX_HOME holds only Codex's own state (and, in lease mode, a placeholder auth.json with
# made-up tokens). SWARM_MODEL_KEY is a placeholder too: the api-key provider's env_key, which
# model.internal's handler replaces with the real key outside the container.
ENV CODEX_HOME=/home/agent/.codex \
    SWARM_MODEL_KEY=swarm-placeholder-not-a-key \
    SWARM_OUT_DIR=/work/out \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
# tini reaps orphaned test processes and forwards SIGTERM to the driver.
ENTRYPOINT ["/usr/bin/tini", "--", "python3", "-m", "harness.slot"]
