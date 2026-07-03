# syntax=docker/dockerfile:1
#
# Production image for the core-chat Next.js frontend.
# Multi-stage: install deps -> build -> minimal runtime that runs `next start`.
# (The project has no `output: "standalone"`, so we ship the built .next + a
# production node runtime and start it the standard way.)

# --- deps: install all dependencies (dev deps are needed for the build) -------
FROM node:24-alpine AS deps
WORKDIR /app
# Some prebuilt native binaries (Tailwind v4 oxide / lightningcss) expect glibc.
RUN apk add --no-cache libc6-compat
# Use the repo-pinned pnpm via corepack rather than a global npm install.
RUN corepack enable && corepack prepare pnpm@11.9.0 --activate
COPY package.json pnpm-lock.yaml ./
# pnpm 10+ blocks unapproved postinstall build scripts (esbuild/sharp/etc.) and
# exits non-zero. Allow them in this isolated build image (no interactive approve).
RUN pnpm config set dangerouslyAllowAllBuilds true \
 && pnpm install --frozen-lockfile

# --- builder: produce the optimized production build --------------------------
FROM node:24-alpine AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat \
 && corepack enable && corepack prepare pnpm@11.9.0 --activate
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm run build

# --- runner: lean runtime that serves the build -------------------------------
FROM node:24-alpine AS runner
WORKDIR /app
RUN apk add --no-cache libc6-compat \
 && corepack enable && corepack prepare pnpm@11.9.0 --activate
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=builder /app/package.json /app/pnpm-lock.yaml /app/next.config.ts ./
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
# Drop to the image's built-in non-root user.
USER node
CMD ["pnpm", "start"]
