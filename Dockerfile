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
# Static SPA served by nginx. No Node.js at runtime.
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
