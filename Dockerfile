FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY packages/cherito-bitcoin-sdk/package.json packages/cherito-bitcoin-sdk/
COPY packages/cherito-checkout-widget/package.json packages/cherito-checkout-widget/
COPY apps/cherito-payments-gateway/package.json apps/cherito-payments-gateway/
RUN npm ci
COPY . .
RUN npm run build
FROM node:24-alpine
ENV NODE_ENV=production PORT=3100
WORKDIR /app
RUN addgroup -S cherito && adduser -S -G cherito cherito && mkdir /app/data && chown cherito:cherito /app/data
COPY --from=build --chown=cherito:cherito /app/package*.json ./
COPY --from=build --chown=cherito:cherito /app/node_modules ./node_modules
COPY --from=build --chown=cherito:cherito /app/packages/cherito-bitcoin-sdk ./packages/cherito-bitcoin-sdk
COPY --from=build --chown=cherito:cherito /app/apps/cherito-payments-gateway ./apps/cherito-payments-gateway
USER cherito
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:3100/health || exit 1
CMD ["node","apps/cherito-payments-gateway/dist/server.js"]
