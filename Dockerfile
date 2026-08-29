# WVTT in one container.
#
# The whole app is a single Node process: it serves the built client, the JSON API and
# the game websocket on one port, so there is nothing here to split into services.
#
# Three stages. The first builds with the full toolchain, the second resolves runtime
# dependencies only, and the third carries just what the server needs to run — no
# compilers, no test tooling, no source.

# ---------------------------------------------------------------- build
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so a change to source code does not re-resolve the dependency tree.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci

COPY . .
RUN npm run build

# ---------------------------------------------------------------- runtime deps
# The server bundle keeps its heavier dependencies external — Colyseus, express and the
# QuickJS WASM build ship their own binaries and assets — so those have to be present at
# runtime even though the rest of the code is bundled.
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
# Only the server's runtime dependencies. Installing every workspace's would drag in
# three.js, React and drei's transitive video and vision libraries — a couple of hundred
# megabytes of code that only ever ran in a browser, and that this image already carries
# as a handful of prebuilt files.
RUN npm ci --omit=dev --workspace=@wvtt/server --include-workspace-root \
  && npm cache clean --force

# ---------------------------------------------------------------- runtime
FROM node:22-alpine AS runtime
WORKDIR /app

# tini reaps zombies and forwards signals, so `docker stop` reaches Node as a clean
# SIGTERM and the room snapshots are written before the process goes away.
RUN apk add --no-cache tini

ENV NODE_ENV=production
ENV PORT=2567
# Room snapshots live here. Mount a volume on it or a restart loses tables in progress.
ENV DATA_DIR=/data

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
# Source maps are for a developer with the repo open, not for a server handing out
# static files; they are several times the size of the code they describe.
RUN find ./client/dist ./server/dist -name '*.map' -delete
# The workspace symlink in node_modules points at this directory. Nothing imports it at
# runtime — the bundle inlined it — but a dangling symlink in node_modules is the kind
# of thing that trips a resolver later.
COPY --from=build /app/shared/package.json ./shared/package.json
COPY package.json ./package.json

# Snapshots contain every card's identity, including face-down ones, so the directory is
# owned by the unprivileged user the server runs as and readable by nobody else.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

EXPOSE 2567
VOLUME ["/data"]

# One HTTP call, no shell pipeline: the health route is cheap and answers before any
# room is created.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server/dist/index.js"]
