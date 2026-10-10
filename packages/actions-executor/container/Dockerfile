# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed
# The Actions job image: one GitHub Actions job per container (docs/claude-opus/25 §3, D6).
# Ubuntu 24.04 like GitHub's ubuntu-24.04 runner, Node 24 as the system node and Node 20 in the
# hosted toolcache, git, curl, python3, build tools, act (host mode), the popular actions baked
# into act's cache (act then never clones them: setup-node alone took 43 s cold in the spike,
# docs/claude-opus/exp/actions-spike/README.md), and the Rust job runner (packages/actions-executor/container).
# Build context is the repo root (the Cargo workspace):
#   docker buildx build --platform linux/amd64 -f packages/actions-executor/container/Dockerfile .

ARG RUST_VERSION=1.96.0
ARG DEBIAN_RELEASE=trixie

FROM --platform=$BUILDPLATFORM rust:${RUST_VERSION}-slim-${DEBIAN_RELEASE} AS chef
ARG RUST_VERSION
ENV RUSTUP_TOOLCHAIN=${RUST_VERSION} \
    CARGO_TARGET_X86_64_UNKNOWN_LINUX_GNU_LINKER=x86_64-linux-gnu-gcc
RUN set -eux; \
    if [ "$(dpkg --print-architecture)" != amd64 ]; then \
      apt-get update; \
      apt-get install -y --no-install-recommends gcc-x86-64-linux-gnu libc6-dev-amd64-cross; \
      rm -rf /var/lib/apt/lists/*; \
    fi; \
    rustup target add x86_64-unknown-linux-gnu; \
    cargo install cargo-chef --locked --version 0.1.78
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --target x86_64-unknown-linux-gnu -p actions-runner --recipe-path recipe.json
COPY . .
RUN cargo build --release --locked --target x86_64-unknown-linux-gnu -p actions-runner

# Ubuntu 24.04, pinned by digest (2026-10-08).
FROM --platform=linux/amd64 ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55
ARG ACT_VERSION=0.2.89
ARG ACT_SHA256=0191d6f1f3b716b5c55820032605d05fc3c1cdbf581ebeff655019e5dd1524c0
ARG NODE24=24.21.0
ARG NODE24_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
ARG NODE20=20.20.2
ARG NODE20_SHA256=df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d
# Static Docker for jobs with services:, container: or Docker actions (act's Docker mode).
ARG DOCKER_VERSION=29.8.2
ARG DOCKER_SHA256=995d1ef289677f74fd58d8d2c35727b6a4ee389c69db8638a3e42d0487aa5b0f
# Bump with every change to this file or the job runner; reported by /version and each result.
ARG IMAGE_VERSION=actions-runner-2026-10-09.7
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl wget git git-lfs openssh-client gnupg jq unzip zip xz-utils zstd \
      python3 python3-pip python3-venv build-essential pkg-config sudo tini locales tzdata \
      iptables \
 && rm -rf /var/lib/apt/lists/* \
 && locale-gen C.UTF-8 >/dev/null 2>&1 || true

# The runner user, as on GitHub's runners: uid 1001, passwordless sudo (a job may apt-get
# install). The container is one job's own microVM and is destroyed after it.
RUN userdel -r ubuntu 2>/dev/null || true \
 && useradd --uid 1001 --create-home --home-dir /home/runner --shell /bin/bash runner \
 && echo 'runner ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/runner \
 && chmod 0440 /etc/sudoers.d/runner

# Node 24 is the system node (act's host mode runs JavaScript actions with the `node` on PATH).
RUN curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE24}/node-v${NODE24}-linux-x64.tar.xz" \
 && echo "${NODE24_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --exclude='*/share/doc' \
 && rm /tmp/node.tar.xz

# Node 20 and 24 in a hosted-toolcache layout so setup-node finds them without a download.
# act's host mode forces RUNNER_TOOL_CACHE=~/.cache/act/tool_cache, hence the symlink.
RUN set -eux; \
    for spec in "${NODE20}:${NODE20_SHA256}" "${NODE24}:${NODE24_SHA256}"; do \
      version="${spec%%:*}"; sum="${spec#*:}"; dir="/opt/hostedtoolcache/node/${version}/x64"; \
      mkdir -p "$dir"; \
      curl -fsSLo /tmp/n.tar.xz "https://nodejs.org/dist/v${version}/node-v${version}-linux-x64.tar.xz"; \
      echo "${sum}  /tmp/n.tar.xz" | sha256sum -c -; \
      tar -xJf /tmp/n.tar.xz -C "$dir" --strip-components=1; \
      touch "/opt/hostedtoolcache/node/${version}/x64.complete"; \
      rm /tmp/n.tar.xz; \
    done; \
    mkdir -p /home/runner/.cache/act; \
    ln -s /opt/hostedtoolcache /home/runner/.cache/act/tool_cache

RUN curl -fsSLo /tmp/act.tgz "https://github.com/nektos/act/releases/download/v${ACT_VERSION}/act_Linux_x86_64.tar.gz" \
 && echo "${ACT_SHA256}  /tmp/act.tgz" | sha256sum -c - \
 && tar -xzf /tmp/act.tgz -C /usr/local/bin act \
 && rm /tmp/act.tgz

# dockerd runs as root (sudo, from the job runner) only for a job that needs it; the spike
# measured it up in about 2 s with default flags on Cloudflare Containers.
RUN curl -fsSLo /tmp/docker.tgz "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" \
 && echo "${DOCKER_SHA256}  /tmp/docker.tgz" | sha256sum -c - \
 && tar -xzf /tmp/docker.tgz -C /usr/local/bin --strip-components=1 \
 && rm /tmp/docker.tgz

# Popular actions in act's action cache (~/.cache/act/<owner>-<repo>@<ref>); act runs with
# --action-offline-mode, so these are used as baked and others are fetched once per job. act
# deletes and re-clones a cached action whose origin differs from the URL it would fetch it
# from; the job runner passes each of these (and every action a job uses) as
# --replace-ghe-action-with-github-com, so that URL is https://github.com/<owner>/<repo>, the
# origin they are cloned with here.
RUN set -eux; \
    for spec in actions/checkout@v4 actions/checkout@v5 actions/setup-node@v4 actions/setup-node@v5 \
      actions/cache@v4 actions/upload-artifact@v4 actions/download-artifact@v4 \
      actions/setup-python@v5 actions/github-script@v7 cloudflare/wrangler-action@v3; do \
      repo="${spec%@*}"; ref="${spec#*@}"; \
      git clone -q --depth 1 --branch "$ref" "https://github.com/${repo}" \
        "/home/runner/.cache/act/$(echo "$repo" | tr / -)@${ref}"; \
      rm -rf "/home/runner/.cache/act/$(echo "$repo" | tr / -)@${ref}/.git/hooks"; \
    done; \
    chown -R runner:runner /home/runner /opt/hostedtoolcache

COPY --from=builder /app/target/x86_64-unknown-linux-gnu/release/actions-runner /usr/local/bin/actions-runner
# The dependency cache tool (docs/claude-opus/27) and a zstd beside it: Docker-mode job
# containers mount this directory read-only, so the tool runs there too (zstd needs only
# liblzma, liblz4 and zlib, present in every Ubuntu image).
COPY --from=builder /app/target/x86_64-unknown-linux-gnu/release/gitstalk-deps /opt/gitstalk/bin/gitstalk-deps
RUN cp /usr/bin/zstd /opt/gitstalk/bin/zstd
USER runner
WORKDIR /home/runner
ENV PORT=8080 \
    WORK_ROOT=/home/runner/work \
    ACT_BIN=/usr/local/bin/act \
    ACT_VERSION=${ACT_VERSION} \
    IMAGE_VERSION=${IMAGE_VERSION} \
    RUNNER_TOOL_CACHE=/opt/hostedtoolcache \
    RUST_LOG=info
EXPOSE 8080
# tini reaps the step processes act leaves behind and forwards SIGTERM to the job runner.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/actions-runner"]
