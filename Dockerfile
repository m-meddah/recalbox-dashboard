# ─── Stage 1: Build ───────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

# Native deps required by better-sqlite3
RUN apk add --no-cache python3 make g++ gcc sqlite-dev

RUN corepack enable && corepack prepare pnpm@10.26.2 --activate

WORKDIR /app

# Install dependencies first (cache layer before source copy)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/dashboard/package.json ./apps/dashboard/
# Copy scraper-core in full (workspace:* dep, source needed for pnpm linking)
COPY packages/scraper-core/ ./packages/scraper-core/

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# Copy remaining source (invalidates cache only on source changes)
COPY apps/dashboard/ ./apps/dashboard/
# Ensure public/ exists (Next.js standalone expects it even if empty)
RUN mkdir -p apps/dashboard/public

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter @recalbox/dashboard build

# Compile scrobbler TypeScript → JS (no tsx required at runtime)
RUN pnpm --filter @recalbox/dashboard run build:scrobbler

# Compile the admin-bootstrap CLI → JS (no tsx required at runtime)
RUN pnpm --filter @recalbox/dashboard run build:create-user

# ─── Stage 2: Production runner ───────────────────────────────────────────────
FROM node:22-alpine AS runner

ARG S6_OVERLAY_VERSION=3.2.0.0
ARG TARGETARCH

# Install s6-overlay (multi-arch) then clean up download tools
RUN apk add --no-cache xz curl ca-certificates && \
    case "${TARGETARCH}" in \
      amd64)  S6_ARCH=x86_64 ;; \
      arm64)  S6_ARCH=aarch64 ;; \
      arm)    S6_ARCH=armhf ;; \
      *)      S6_ARCH=x86_64 ;; \
    esac && \
    curl -fsSL -o /tmp/s6-noarch.tar.xz \
      "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-noarch.tar.xz" && \
    curl -fsSL -o /tmp/s6-arch.tar.xz \
      "https://github.com/just-containers/s6-overlay/releases/download/v${S6_OVERLAY_VERSION}/s6-overlay-${S6_ARCH}.tar.xz" && \
    tar -C / -Jxpf /tmp/s6-noarch.tar.xz && \
    tar -C / -Jxpf /tmp/s6-arch.tar.xz && \
    rm -f /tmp/s6-*.tar.xz && \
    apk del xz curl ca-certificates

# Non-root user (UID 1001)
RUN addgroup -g 1001 dashboard && \
    adduser -D -H -u 1001 -G dashboard dashboard

WORKDIR /app

# Copy Next.js standalone output (contains server.js + traced node_modules)
COPY --from=builder /app/apps/dashboard/.next/standalone/ ./

# Static files and public dir (paths relative to server.js location in standalone)
# Next.js with monorepo outputFileTracingRoot places server.js under apps/dashboard/
COPY --from=builder /app/apps/dashboard/.next/static/ ./apps/dashboard/.next/static/
COPY --from=builder /app/apps/dashboard/public/ ./apps/dashboard/public/

# Compiled scrobbler (placed at standalone root by esbuild --outfile)
# scrobbler.js is already inside standalone/ from the build step

# Drizzle migrations (needed by migrate.js at startup)
COPY --from=builder /app/apps/dashboard/drizzle/ ./drizzle/

# Migration script and s6 service definitions
COPY docker/migrate.js ./migrate.js
COPY docker/s6-rc.d /etc/s6-overlay/s6-rc.d

# Make s6 service scripts executable
RUN find /etc/s6-overlay/s6-rc.d \( -name 'run' -o -name 'up' -o -name 'finish' \) \
    -exec chmod +x {} +

# Persistent data volume and fix ownership
RUN mkdir -p /data && \
    chown -R dashboard:dashboard /data /app

VOLUME /data
EXPOSE 3000

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_PATH=/data/recalbox.db
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health',r=>r.statusCode===200?process.exit(0):process.exit(1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["/init"]
