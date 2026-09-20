# syntax=docker/dockerfile:1
# Self-hosted production images — three targets on a shared base:
#   web     : standalone Next.js (slim image, server traced over the monorepo)
#   worker  : BullMQ jobs (tsx over the sources, as in development)
#   migrate : one-shot — Drizzle migrations + application role + RLS
#             (+ demo workspace if SEED_DEMO=true)
# and one target that shares nothing with them:
#   synthetic : the browser runner, on Microsoft's Playwright image
# Build context: the repository root (see compose.yaml).

FROM node:22-alpine AS build
RUN npm install -g pnpm@11.21.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN NEXT_OUTPUT=standalone pnpm --filter @openincident/web build
RUN NEXT_OUTPUT=standalone pnpm --filter @openincident/status build

# ---------- web: standalone server ----------
FROM node:22-alpine AS web
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
# `public/` is NOT part of the standalone output — Next expects the image to
# carry it. Without this line the self-hosted woff2 answer 404 and every screen
# silently falls back to system fonts, and so does the favicon. Nothing fails
# loudly; the product simply stops looking like itself.
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]

# ---------- status: the public status pages, isolated ----------
FROM node:22-alpine AS status
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build /repo/apps/status/.next/standalone ./
COPY --from=build /repo/apps/status/.next/static ./apps/status/.next/static
COPY --from=build /repo/apps/status/public ./apps/status/public
EXPOSE 3001
CMD ["node", "apps/status/server.js"]

# ---------- worker: BullMQ over the sources ----------
FROM build AS worker
ENV NODE_ENV=production
# iputils, for the ping monitor. Node cannot open an ICMP socket itself, and
# busybox's ping still wants CAP_NET_RAW; iputils uses the unprivileged ICMP
# datagram socket that Docker already allows through net.ipv4.ping_group_range.
RUN apk add --no-cache iputils
CMD ["pnpm", "--filter", "@openincident/worker", "start"]

# ---------- synthetic: the browser runner, in an image of its own ----------
# Chromium is about 400 MB of image and several hundred megabytes of memory per
# run, for a feature not every installation uses. Putting it in the worker would
# make everyone download it; it is a target of its own, started only by the
# `synthetic` compose profile.
#
# The install is redone here instead of being copied from `build`: that stage is
# Alpine (musl) and this one is Debian (glibc), and a node_modules tree resolved
# for one does not run on the other.
FROM mcr.microsoft.com/playwright:v1.62.1-jammy AS synthetic
ENV NODE_ENV=production
# The base image already carries the browsers Playwright 1.62 expects, here.
# Without this variable playwright-core looks under ~/.cache instead and
# downloads a second copy on the first journey — at the worst possible moment.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
RUN npm install -g pnpm@11.21.0
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
CMD ["pnpm", "--filter", "@openincident/synthetic", "start"]

# ---------- telemetry: the OTLP ingestion endpoint ----------
# Its own target rather than a second command on the worker, because it is the
# only service in the stack that faces the outside on a port of its own and is
# started by a profile: an installation without a column store should not be
# running it at all, and one with a very busy one may want several.
FROM build AS telemetry
ENV NODE_ENV=production
CMD ["pnpm", "--filter", "@openincident/telemetry-ingest", "start"]

# ---------- migrate: migrations + RLS (+ demo seed) ----------
FROM build AS migrate
# The column store's migrations run here too, and only when one is configured:
# `ch:migrate` is a no-op without CLICKHOUSE_URL, so an installation that never
# starts the telemetry profile is not asked to have one. Running them in the
# same place as the Postgres migrations is what keeps a deployment from having
# a schema on one side and not the other.
CMD ["sh", "-c", "pnpm --filter @openincident/db db:migrate && pnpm --filter @openincident/db db:rls && if [ -n \"$CLICKHOUSE_URL\" ]; then pnpm ch:migrate; fi && if [ \"$SEED_DEMO\" = \"true\" ]; then pnpm db:seed && pnpm db:seed:auth; fi"]
