# =============================================================================
# GenPaper Production Dockerfile
# Multi-stage build optimized for Azure Container Apps (using Bun)
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Dependencies
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS deps
WORKDIR /app

# Install dependencies needed for native modules
RUN apk add --no-cache libc6-compat python3 make g++

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile || bun install

# -----------------------------------------------------------------------------
# Stage 2: Builder
# -----------------------------------------------------------------------------
FROM oven/bun:1-alpine AS builder
WORKDIR /app

# Next.js lockfile patch step shells out to npm; ensure npm exists in builder.
RUN apk add --no-cache nodejs npm

# Build-time arguments for environment variables needed during build
# These are required for Next.js static page generation
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG OPENAI_API_KEY
ARG CONTACT_EMAIL=noreply@genpaper.ai
# Polar product IDs (needed for client-side checkout URLs)
ARG NEXT_PUBLIC_POLAR_PRODUCT_STARTER
ARG NEXT_PUBLIC_POLAR_PRODUCT_PRO
ARG NEXT_PUBLIC_POLAR_PRODUCT_STARTER_YEARLY
ARG NEXT_PUBLIC_POLAR_PRODUCT_PRO_YEARLY

# Set as environment variables for the build
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV OPENAI_API_KEY=$OPENAI_API_KEY
ENV CONTACT_EMAIL=$CONTACT_EMAIL
ENV NEXT_PUBLIC_POLAR_PRODUCT_STARTER=$NEXT_PUBLIC_POLAR_PRODUCT_STARTER
ENV NEXT_PUBLIC_POLAR_PRODUCT_PRO=$NEXT_PUBLIC_POLAR_PRODUCT_PRO
ENV NEXT_PUBLIC_POLAR_PRODUCT_STARTER_YEARLY=$NEXT_PUBLIC_POLAR_PRODUCT_STARTER_YEARLY
ENV NEXT_PUBLIC_POLAR_PRODUCT_PRO_YEARLY=$NEXT_PUBLIC_POLAR_PRODUCT_PRO_YEARLY

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Copy tiktoken WASM file to public folder (needed for runtime)
RUN cp node_modules/@dqbd/tiktoken/tiktoken_bg.wasm public/ 2>/dev/null || true

# Set environment variables for build
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# Build the application
RUN bun run build

# -----------------------------------------------------------------------------
# Stage 3: Runner (Production)
# -----------------------------------------------------------------------------
# Use Node.js for runtime - Bun has incomplete node:v8 support causing errors
FROM node:20-alpine AS runner
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy public assets
COPY --from=builder /app/public ./public

# Set correct permissions for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Copy standalone build output
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Install sharp for image optimization
RUN npm install --os=linux --cpu=x64 sharp 2>/dev/null || true

# Switch to non-root user
USER nextjs

# Expose port
EXPOSE 3000

# Set hostname for container
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

# Health check (uses simple liveness endpoint for faster response)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health/live || exit 1

# Start the application with Node.js
CMD ["node", "server.js"]
