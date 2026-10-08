# syntax=docker/dockerfile:1
# npm cache spike image (throwaway): Node 24 + two project manifests + a tiny HTTP server that
# runs `npm ci` in a fresh directory with an empty npm cache and reports the wall time.
FROM --platform=linux/amd64 node:24-bookworm-slim
WORKDIR /spike
COPY projects /spike/projects
COPY server.mjs /spike/server.mjs
EXPOSE 8080
CMD ["node", "/spike/server.mjs"]
