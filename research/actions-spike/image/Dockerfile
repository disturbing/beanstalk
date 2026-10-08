# syntax=docker/dockerfile:1
# check=skip=FromPlatformFlagConstDisallowed
# Actions spike image (throwaway): Ubuntu 24.04 + a GitHub-runner-ish toolchain + nektos/act +
# static Docker (for the DinD probe) + a tiny Node HTTP server (server.mjs) that runs act and
# streams its output. Built by wrangler for the beanstalk-actions-spike Worker; never used by live
# Workers. Build context: this directory.
FROM --platform=linux/amd64 ubuntu:24.04

ARG ACT_VERSION=0.2.89
ARG ACT_SHA256=0191d6f1f3b716b5c55820032605d05fc3c1cdbf581ebeff655019e5dd1524c0
ARG NODE24=24.21.0
ARG NODE24_SHA256=fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6
ARG NODE20=20.20.2
ARG NODE20_SHA256=df770b2a6f130ed8627c9782c988fda9669fa23898329a61a871e32f965e007d
ARG DOCKER_VERSION=29.8.2

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl git python3 xz-utils unzip zstd jq tini sudo iptables \
      make g++ \
 && rm -rf /var/lib/apt/lists/*

# Node 24 as the system node (act's host mode runs JavaScript actions with the `node` on PATH).
RUN curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/dist/v${NODE24}/node-v${NODE24}-linux-x64.tar.xz" \
 && echo "${NODE24_SHA256}  /tmp/node.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --exclude='*/share/doc' \
 && rm /tmp/node.tar.xz

# Node 20 pre-seeded in a hosted-toolcache layout, so setup-node@v4 node-version 20 can hit it.
# act's host mode forces RUNNER_TOOL_CACHE=~/.cache/act/tool_cache, hence the symlink.
RUN mkdir -p "/opt/hostedtoolcache/node/${NODE20}/x64" \
 && curl -fsSLo /tmp/node20.tar.xz "https://nodejs.org/dist/v${NODE20}/node-v${NODE20}-linux-x64.tar.xz" \
 && echo "${NODE20_SHA256}  /tmp/node20.tar.xz" | sha256sum -c - \
 && tar -xJf /tmp/node20.tar.xz -C "/opt/hostedtoolcache/node/${NODE20}/x64" --strip-components=1 \
 && touch "/opt/hostedtoolcache/node/${NODE20}/x64.complete" \
 && mkdir -p /root/.cache/act && ln -s /opt/hostedtoolcache /root/.cache/act/tool_cache \
 && rm /tmp/node20.tar.xz

RUN curl -fsSLo /tmp/act.tgz "https://github.com/nektos/act/releases/download/v${ACT_VERSION}/act_Linux_x86_64.tar.gz" \
 && echo "${ACT_SHA256}  /tmp/act.tgz" | sha256sum -c - \
 && tar -xzf /tmp/act.tgz -C /usr/local/bin act \
 && rm /tmp/act.tgz

# Static Docker engine + CLI, only for the DinD probe (dockerd must run as root).
RUN curl -fsSLo /tmp/docker.tgz "https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_VERSION}.tgz" \
 && tar -xzf /tmp/docker.tgz -C /usr/local/bin --strip-components=1 \
 && rm /tmp/docker.tgz

# Pre-baked actions in act's (old-style) action cache, ~/.cache/act/<owner>-<repo>@<ref>. Without
# this, act full-clones each action per job (actions/setup-node alone took 43 s on the first run).
# Run act with --action-offline-mode so it uses these as they are.
RUN set -eux; for spec in actions/checkout@v4 actions/setup-node@v4 actions/cache@v4 \
      actions/upload-artifact@v4 actions/download-artifact@v4; do \
      repo="${spec%@*}"; ref="${spec#*@}"; \
      git clone -q --depth 1 --branch "$ref" "https://github.com/${repo}" \
        "/root/.cache/act/$(echo "$repo" | tr / -)@${ref}"; \
    done; du -sh /root/.cache/act/*

COPY server.mjs /opt/spike/server.mjs
ENV PORT=8080 RUNNER_TOOL_CACHE=/opt/hostedtoolcache WORK_ROOT=/work
EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/spike/server.mjs"]
