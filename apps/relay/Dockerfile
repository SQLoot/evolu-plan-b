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

# Prune dev dependencies to create a production-ready environment
RUN bun install --production

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

# Copy the entire pruned monorepo context (builds + production deps)
# This ensures workspace symlinks in node_modules work correctly.
COPY --from=installer --chown=evolu:nodejs /app/ .

# Declare data volume for clarity and persistence
VOLUME ["/app/data"]

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD bun -e "const net=require('net');const s=net.connect(4000,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"

# Start the application
CMD ["bun", "apps/relay/dist/index.js"] 