# syntax=docker/dockerfile:1
# Dependency-restore spike image (throwaway, docs/claude-opus/27-ci-dependency-cache.md).
# Node 24 on Debian trixie (current squashfs-tools/erofs-utils/squashfuse), filesystem tools for
# the mount probes, fio for disk numbers, fastify's source at v5.6.1 with the arena lockfile, and
# a tiny job server (POST /job runs a shell command in the background; GET /job/<id> reads it).
# Runs as root on purpose: the probes ask what a root process (the job image's `sudo`) may mount.
FROM --platform=linux/amd64 node:24-trixie
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      zstd pigz curl ca-certificates git python3 procps time fio \
      squashfs-tools squashfuse erofs-utils erofsfuse fuse3 fuse-overlayfs util-linux libcap2-bin \
 && rm -rf /var/lib/apt/lists/*
RUN git clone -q --depth 1 --branch v5.6.1 https://github.com/fastify/fastify /spike/src/fastify \
 && rm -rf /spike/src/fastify/.git
COPY projects /spike/projects
# The arena manifest and lockfile (the runs copied package.json in at run time; same result).
RUN cp /spike/projects/fastify/package.json /spike/projects/fastify/package-lock.json /spike/src/fastify/
COPY server.mjs tools/ /spike/
WORKDIR /spike
EXPOSE 8080
CMD ["node", "/spike/server.mjs"]
