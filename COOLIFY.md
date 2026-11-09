# Deploying to Hetzner with Coolify

This app is a static React SPA, so it ships as a small **nginx container**. There is
no database, no persistent volume, and no server-side Node.js at runtime.

> **Current target:** repo `vishalgojha/sdagent`, branch `main`, domain
> `https://mf.vishalojha.me`.

The repo includes:

| File | Purpose |
|---|---|
| `Dockerfile` | Multi-stage build: `npm ci && npm run build`, then serve `dist/` with nginx |
| `nginx.conf` | SPA fallback, gzip, asset caching, security headers, `/healthz` |
| `.dockerignore` | Keeps the build context small |

## 1. Put the code on a Git repo Coolify can reach

Coolify deploys from Git. This repo is already pushed to
`git@github.com:vishalgojha/sdagent.git` on `main`.

```bash
git add -A
git commit -m "Update app"
git push origin main
```

## 2. Create the application in Coolify

1. Open Coolify → your **Project** → **+ New Resource** → **Application**.
2. **Repository:** `vishalgojha/sdagent`, **Branch:** `main`.
3. **Build Pack:** `Dockerfile`
4. **Base Directory:** `/`
5. **Dockerfile Location:** `/Dockerfile`
6. **Ports Exposes:** `80`
7. **Healthcheck:**
   - Path: `/healthz`
   - Port: `80`
   - Method: `GET`
   - Expected status: `200`
8. **Domain:** `https://mf.vishalojha.me`, with **HTTPS** enabled
   (Coolify provisions/renews the Let's Encrypt certificate).
9. **Persistent Storage:** none — this app is stateless.
10. Click **Deploy**.

Coolify builds the image, starts the container, waits for `/healthz`, and puts it
behind its Traefik proxy.

> Reusing an existing application? Remove any persistent storage and set the
> exposed port to `80`; otherwise Coolify keeps the old container settings.

## 3. DNS

`mf.vishalojha.me` already has an `A` record pointing at the Hetzner server
(`62.238.18.85`), so no DNS change is needed. Keep Coolify's ports 80/443 open in
the Hetzner firewall.

## 4. Optional: override the MFAPI URL

The app defaults to `https://api.mfapi.in/mf/`, so no environment variable is
required. To point somewhere else, add a **build-time** variable in Coolify:

```
VITE_MFAPI_URL=https://your-proxy.example.com/mf/
```

Because Vite inlines `VITE_*` variables at build time, changing it requires a
redeploy (rebuild), not just a restart.

## 5. Updating the Nifty 50 snapshot

`public/data/nifty50.json` is baked into the image. To refresh it:

```bash
npm run update:nifty
git add public/data/nifty50.json
git commit -m "Refresh Nifty 50 snapshot"
git push
```

With auto-deploy enabled, the push triggers a rebuild and the new data goes live.
A daily Cron job on the server or a GitHub Action can run the same command if you
want this fully automatic.

## Local container test (optional)

```bash
docker build -t india-mutual-fund .
docker run --rm -p 8080:80 india-mutual-fund
# open http://localhost:8080
```

## Operational notes

- **Stateless:** scale or redeploy freely; no volumes or migrations.
- **Data lives in Git:** the Nifty snapshot and fund universe are versioned, so
  there is nothing to back up.
- **Runtime dependency:** browsers call MFAPI.in directly. If you later add a
  proxy/cache, put it behind the same domain and set `VITE_MFAPI_URL`.
- **Zero-downtime deploys:** Coolify starts the new container and switches traffic
  after `/healthz` passes.
