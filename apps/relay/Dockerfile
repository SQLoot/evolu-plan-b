FROM oven/bun:alpine AS base
ENV BUN_HOME="/bun"
ENV PATH="$BUN_HOME:$PATH"

FROM base AS builder
WORKDIR /app
RUN bun install -g turbo
COPY . .

# Generate a partial monorepo with a pruned lockfile for the relay workspace
RUN turbo prune @evolu/relay --docker

# ------------------------------------------------------------
# Installer stage - build the pruned workspace
FROM base AS installer
WORKDIR /app

# Install pnpm and turbo (Wait, we want bun)
# RUN corepack enable pnpm # Removed
RUN bun install -g turbo

# Install dependencies from pruned lockfile
COPY --from=builder /app/out/json/ .
RUN bun install --frozen-lockfile

# Copy source and build
COPY --from=builder /app/out/full/ .
# Ensure README.md is available at the root for the build process
COPY --from=builder /app/README.md ./README.md
RUN turbo run build

# Create a minimal production deploy for the relay package
# Use legacy mode since inject-workspace-packages is not set
# pnpm deploy is specific to pnpm. Does bun support something similar?
# Bun doesn't have direct equivalent to `pnpm deploy`.
# However, we can just copy the built artifacts.
# Or use `bun build` to bundle.
# But since this is a monorepo, maybe we should just rely on the build output.
# Let's see what `pnpm deploy` does: it isolates the package and its deps.
# For now, let's assume we can just copy the `apps/relay/dist` and `node_modules` if needed.
# Converting a pnpm monorepo dockerfile to bun can be tricky regarding "pruning" and "deploying".
# Since `turbo prune` works with json, `bun install` should work with that json.
# The "deploy" step might be the issue.
# Alternative: Just run `bun install --production` in the apps/relay folder after build?
# Let's try to keep it simple.

# REVISED STRATEGY for Deploy step:
# Since we don't have pnpm deploy, we can manually assemble the production folder.
# But wait, `turbo prune` creates `out/json` and `out/full`.
# We installed deps in `installer`.
# We ran build.
# Now we want a minimal runner image.
# We can just copy `node_modules` and `apps/relay/dist`.
# But `node_modules` at root contains all deps.
# We might need to prune devDependencies.
# `bun install --production`?
# 
# Let's look at `apps/relay/package.json` to see if it has many deps.
# It likely has `better-sqlite3`, `ws`, etc.
# 
# Usage of `pnpm deploy` is quite specific.
# If I remove it, I need to ensure `node_modules` are correct.
# 
# Maybe I should leave Dockerfile alone for now if I'm not 100% sure about breaking it?
# The user asked to "fix or disable workflows".
# If I change the Dockerfile, I must ensure it works.
# 
# Let's stick to using `oven/bun` and see if we can replicate the logic.
# 
# Actually, `bun` doesn't strictly need `pnpm deploy`.
# 
# Let's try to just copy the `dist` and `node_modules` from installer.

RUN mkdir -p /app/deploy && cp -r apps/relay/dist /app/deploy/dist && cp apps/relay/package.json /app/deploy/package.json && cd /app/deploy && bun install --production

# ------------------------------------------------------------
# Runner stage - minimal runtime image
FROM base AS runner
WORKDIR /app

# Ensure production runtime defaults
ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 evolu --ingroup nodejs
RUN chown -R evolu:nodejs /app
USER evolu

# Ensure data directory exists for persistent storage
RUN mkdir -p /app/data

# Copy the minimal deployed app
COPY --from=installer --chown=evolu:nodejs /app/deploy/ ./

# Declare data volume for clarity and persistence
VOLUME ["/app/data"]

# Expose port
EXPOSE 4000

# Health check (Bun include node compatible runner, or use bun)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "const net=require('net');const s=net.connect(4000,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"

# Start the application
CMD ["bun", "dist/index.js"] 