FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm run build
# Filter only production dependencies for the gateway
RUN pnpm --filter cherito-payments-gateway --prod deploy --legacy /app/pruned

FROM node:22-alpine AS production
ENV NODE_ENV=production PORT=3100
WORKDIR /app
RUN addgroup -S cherito && adduser -S -G cherito cherito && mkdir /app/data && chown cherito:cherito /app/data
COPY --from=build --chown=cherito:cherito /app/pruned /app
USER cherito
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3100/health || exit 1
CMD ["node", "dist/server.js"]
