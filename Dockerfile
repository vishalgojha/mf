# --- Build stage -----------------------------------------------------------
FROM node:20-alpine AS build
WORKDIR /app

# Optional build-time override. If unset, src/utils/mfapi.js falls back to
# https://api.mfapi.in/mf/. Set it in Coolify as a build variable if needed.
ARG VITE_MFAPI_URL
ENV VITE_MFAPI_URL=${VITE_MFAPI_URL}

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# --- Runtime stage ---------------------------------------------------------
# One Node process serves the static SPA and the Instinct API. The API needs the
# deterministic toolkit plus the built snapshots, not the full frontend source.
# Python 3 + yfinance are required by server/screener_fetcher.py for the
# /api/screener endpoint (NSE equity fundamentals via Yahoo Finance).
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production PORT=8080

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server ./server
COPY --chown=node:node src/agent ./src/agent
COPY --chown=node:node src/data ./src/data
COPY --chown=node:node src/utils ./src/utils
COPY --chown=node:node package.json ./

# Coolify's HTTP healthcheck needs curl or wget inside the image.
# Python is needed for the screener data fetcher.
RUN apk add --no-cache curl python3 py3-pip && \
    pip3 install --no-cache-dir yfinance

USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1

CMD ["node", "server/index.mjs"]
