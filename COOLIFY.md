# Deploying to Hetzner with Coolify

LevelLens is a React SPA plus a small Node server that exposes the Instinct API.
It ships as one container, serves the site and `/api/instinct` from the same
origin, and has no database or persistent volume.

> **Current target:** repo `vishalgojha/mf`, branch `main`, domain
> `https://mf.vishalojha.me`.

The repo includes:

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: `npm ci && npm run build`, then a Node runtime on port `8080` |
| `server/` | Static file server, Instinct API, agent loop, provider fallback |
| `src/agent/tools.js` | Deterministic calculations shared by the API and the app |
| `.dockerignore` | Keeps the build context small and excludes `.env` |

## 1. Put the code on a Git repo Coolify can reach

Coolify deploys from Git. This repo is already pushed to
`git@github.com:vishalgojha/mf.git` on `main`.

```bash
git add -A
git commit -m "Update app"
git push origin main
```

## 2. Create or update the application in Coolify

1. Open Coolify → your **Project** → **+ New Resource** → **Application**
   (or open the existing `levellens` app).
2. **Repository:** `vishalgojha/mf`, **Branch:** `main`.
3. **Build Pack:** `Dockerfile`
4. **Base Directory:** `/`
5. **Dockerfile Location:** `/Dockerfile`
6. **Ports Exposes:** `8080`
7. **Healthcheck:**
   - Path: `/healthz`
   - Port: `8080`
   - Method: `GET`
   - Expected status: `200`
8. **Domain:** `https://mf.vishalojha.me`, with **HTTPS** enabled
   (Coolify provisions/renews the Let's Encrypt certificate).
9. **Persistent Storage:** none — this app is stateless.
10. Click **Deploy**.

Coolify builds the image, starts the container, waits for `/healthz`, and puts it
behind its Traefik proxy.

> Reusing an existing application? Change the exposed port from `80` to `8080`
> and clear any persistent storage, or Coolify keeps the old container settings.

## 3. DNS

`mf.vishalojha.me` already has an `A` record pointing at the Hetzner server
(`62.238.18.85`), so no DNS change is needed. Keep Coolify's ports 80/443 open in
the Hetzner firewall.

The API is served from the same domain under `/api/instinct`. No separate
`api.` or `instinct.` subdomain is required.

## 4. Environment variables

The app defaults to `https://api.mfapi.in/mf/`, so no frontend variable is
required. To point somewhere else, add a **build-time** variable:

```
VITE_MFAPI_URL=https://your-proxy.example.com/mf/
```

Because Vite inlines `VITE_*` variables at build time, changing it requires a
redeploy (rebuild), not just a restart.

For the Instinct agent, add **runtime** variables. Keys are never baked into the
image and must not be committed:

```
NVIDIA_API_KEY=nvapi-...
# and/or
OPENROUTER_API_KEY=sk-or-v1-...

# Optional
INSTINCT_PROVIDERS=nvidia,openrouter
NVIDIA_MODEL=meta/llama-3.3-70b-instruct
OPENROUTER_MODEL=meta-llama/llama-3.3-70b-instruct:free
INSTINCT_API_KEY=<long-random-token>       # protect POST /api/instinct/ask
INSTINCT_ALLOWED_ORIGINS=*
INSTINCT_ASK_RATE_LIMIT=10
INSTINCT_TOOL_RATE_LIMIT=120
```

Without a provider key the deterministic tool endpoints still work. `/ask`
returns `503` with a clear message. See [INSTINCT.md](INSTINCT.md).

## 5. Updating the snapshots

`public/data/nifty50.json` and `public/data/funds.json` are baked into the image.
Refresh Nifty first (the fund snapshot uses its coverage window), then funds:

```bash
npm run update:nifty
npm run update:funds
npm run check:returns
npm run check:tools
git add public/data/nifty50.json public/data/funds.json
git commit -m "Refresh bundled market data"
git push
```

The `.github/workflows/refresh-data.yml` workflow does this daily, runs the
checks, verifies the build, and commits any changes.

With auto-deploy enabled, the push triggers a rebuild and the new data goes live.

## Local container test (optional)

```bash
docker build -t levellens .
docker run --rm -p 8080:8080 levellens
# open http://localhost:8080
```

To exercise `/ask` without a key, run the checks locally:

```bash
npm run check:tools
npm run check:agent
npm run build && npm run check:api
```

## Operational notes

- **Stateless:** scale or redeploy freely; no volumes or migrations.
- **Data lives in Git:** the Nifty and fund snapshots are versioned, so there is
  nothing to back up.
- **One origin:** the SPA and the API share `https://mf.vishalojha.me`; the
  browser uses relative `/api/instinct/...` URLs.
- **Rate limits are in-memory:** they reset on restart and are per container. For
  multiple replicas, move them to a shared store.
- **Zero-downtime deploys:** Coolify starts the new container and switches traffic
  after `/healthz` passes.
