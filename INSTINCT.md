# Instinct API

LevelLens exposes its calculations as a small HTTP API so **Instinct AI** (or any
other agent) can ask questions and get numbers that are computed deterministically
from the bundled snapshots. The model never does arithmetic.

There are two ways to use it:

| Mode | Endpoint | Model key needed | Who pays for inference |
|---|---|---|---|
| **Tools-only** | `POST /api/instinct/tools/:name` | No | Instinct / your client |
| **Hosted agent** | `POST /api/instinct/ask` | Yes, free NVIDIA NIM or OpenRouter key | This server's key |

Tools-only is the cheapest integration: Instinct runs its own model and calls
LevelLens for the facts. The hosted agent is convenient when the caller does not
have a model.

Base URL: `https://mf.vishalojha.me/api/instinct`

---

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/healthz` | Plain-text container health check (`ok`). |
| `GET` | `/api/instinct` | Service index and endpoint list. |
| `GET` | `/api/instinct/health` | Data coverage, provider status, uptime. |
| `GET` | `/api/instinct/tools` | Tool catalog with JSON Schemas. |
| `POST` | `/api/instinct/tools/:name` | Call one deterministic tool. |
| `POST` | `/api/instinct/keys` | Issue a free one-time key for one `/ask` request. |
| `GET` | `/api/instinct/models` | Configured providers and models (never keys). |
| `GET` | `/api/instinct/openapi.json` | OpenAPI 3.1 document for code generation and validation. |
| `POST` | `/api/instinct/ask` | Run the bounded tool-calling agent. |

### Quick checks

```bash
curl -s https://mf.vishalojha.me/api/instinct/health | jq

curl -s https://mf.vishalojha.me/api/instinct/tools | jq '.tools[].name'
```

The home page can issue a free one-time bearer key. It expires after 10 minutes
and is consumed by the first `/ask` request:

```bash
curl -s -X POST https://mf.vishalojha.me/api/instinct/keys | jq
```

### Call a tool

```bash
curl -s -X POST https://mf.vishalojha.me/api/instinct/tools/resolve_window \
  -H 'Content-Type: application/json' \
  -d '{"from":22600,"to":25000}' | jq
```

```json
{
  "tool": "resolve_window",
  "ok": true,
  "summary": "Nifty 22600 (2026-10-23) → 25030.35 (2026-11-06), 10.75% over 11 sessions.",
  "result": {
    "status": "ready",
    "startDate": "2026-10-23",
    "endDate": "2026-11-06",
    "startLevel": 22600,
    "endLevel": 25030.35,
    "niftyReturn": 10.75,
    "tradingDays": 11
  }
}
```

```bash
curl -s -X POST https://mf.vishalojha.me/api/instinct/tools/rank_funds \
  -H 'Content-Type: application/json' \
  -d '{"from":22600,"to":25000,"category":"Index","limit":5}' | jq '.result.funds'
```

Invalid arguments return `400` with `{ "code": "invalid_arguments", "error": "..." }`.
A valid query with no matching history returns `200` and `result.status:
"nomatch"` (or `"invalid"`), so clients can distinguish bad input from bad data.

### Ask the hosted agent

```bash
curl -s -X POST https://mf.vishalojha.me/api/instinct/ask \
  -H 'Content-Type: application/json' \
  -d '{
    "question": "Who beat Nifty between 22,600 and 25,000, and which category led?",
    "includeToolResults": false
  }' | jq
```

```json
{
  "answer": "Nifty rose 10.75% from 2026-10-23 to 2026-11-06. ...",
  "provider": "nvidia",
  "model": "meta/llama-3.3-70b-instruct",
  "steps": 3,
  "truncated": false,
  "window": {
    "startDate": "2026-10-23",
    "endDate": "2026-11-06",
    "startLevel": 22600,
    "endLevel": 25030.35,
    "niftyReturn": 10.75,
    "tradingDays": 11
  },
  "trace": [
    { "name": "resolve_window", "ok": true, "summary": "..." },
    { "name": "rank_funds", "ok": true, "summary": "..." },
    { "name": "category_stats", "ok": true, "summary": "..." }
  ],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 },
  "data": { "nifty": { "...": "..." }, "funds": { "...": "..." } },
  "disclaimer": "Educational analysis of bundled historical NAV data. Not investment advice.",
  "requestId": "..."
}
```

Request body:

| Field | Type | Notes |
|---|---|---|
| `question` | string | Required, 1–2000 characters. |
| `from` / `to` | number | Optional Nifty levels passed as context. |
| `category` | string | Optional category hint. |
| `provider` | `"auto"` \| `"nvidia"` \| `"openrouter"` | Default `auto`, falls back on failure. |
| `model` | string | Ignored unless `INSTINCT_ALLOW_MODEL_OVERRIDE=1`. |
| `includeToolResults` | boolean | Include full tool payloads in `trace` for auditing. |

The agent is bounded by `INSTINCT_MAX_STEPS` (default 6). If it runs out, it makes
one final tool-free call and returns `truncated: true` with a note.

---

## Tool catalog

| Tool | Arguments | Returns |
|---|---|---|
| `resolve_window` | `from`, `to` | Window dates, Nifty closes, Nifty return, session count. |
| `rank_funds` | `from`, `to`, `category?`, `limit?` | 62-fund ranking with return, alpha, NAV dates, stale flags, excluded funds. |
| `category_stats` | `from`, `to` | Per-category average/median return, average alpha, breadth, best/worst. |
| `analog_windows` | `movePct?`, `tolerancePct?`, `maxDays?`, `direction?`, `category?`, `minObservations?`, `limit?` | Every similar historical move, plus funds ranked by hit rate and median alpha. |
| `fund_detail` | `code`, `from?`, `to?` | One fund's NAV series and return. Defaults to the last 365 days. |
| `fund_data` | `from?`, `to?`, `fromDate?`, `toDate?`, `limit?` | Bulk NAV series for up to all 62 covered funds, using either a Nifty level window or explicit dates. |
| `market_overview` | `lookbackDays?` | Latest Nifty close, 1w/1m/3m/6m/1y returns, range and drawdown. |
| `list_funds` | none | The 62-fund universe with codes, names and categories. |

`GET /api/instinct/tools` returns the authoritative JSON Schema for each tool.

---

## Data contract

- **Nifty 50**: bundled daily closes from `public/data/nifty50.json`.
- **Funds**: 62 curated Direct-Growth schemes from `public/data/funds.json`
  (MFAPI.in), merged with the Nifty coverage window.
- A window starts at the most recent Nifty close **at or below** `from` and ends
  at the first later close **at or above** `to`.
- Fund returns use the closest NAV **on or before** each boundary date.
- A fund with no NAV on or before the window start is **excluded**, never measured
  from its first NAV. Exclusions are returned in `rank_funds.excluded`.
- `staleDays` / `startStaleDays` flag boundary NAVs more than 3 days away from the
  requested date. The UI and the agent both mention stale data.
- Returns are NAV growth in percent. Alpha is percentage points versus the Nifty
  return over the same dates.

`GET /api/instinct/health` shows the snapshot dates and row counts in use.

---

## Providers and cost

Both providers use an OpenAI-compatible `/chat/completions` endpoint with tool
calling.

| Provider | Environment | Default model |
|---|---|---|
| NVIDIA NIM | `NVIDIA_API_KEY` | `meta/llama-3.3-70b-instruct` |
| OpenRouter | `OPENROUTER_API_KEY` | `meta-llama/llama-3.3-70b-instruct:free` |

- Order comes from `INSTINCT_PROVIDERS` (default `nvidia,openrouter`).
- Unconfigured providers are skipped. If all fail, `/ask` returns `502` with a
  `providers` array of sanitized errors.
- With no key, `/ask` returns `503` and the deterministic endpoints keep working.
- Override models with `NVIDIA_MODEL` / `OPENROUTER_MODEL`.
- `INSTINCT_ALLOW_MODEL_OVERRIDE=1` lets callers choose a model. Leave it off to
  avoid unexpected spend.
- Keys are read from the environment and never appear in responses or logs.

Free tiers have rate limits. The API does not retry aggressively; it falls back
to the next provider once, then returns an actionable error.

---

## Auth and limits

- `/ask` requires a free one-time `Authorization: Bearer <token>` by default;
  generate one with `POST /api/instinct/keys` or from the home page. It expires
  after 10 minutes and is consumed by one request. Set `INSTINCT_API_KEY` to
  also allow a permanent server token. Set `INSTINCT_REQUIRE_KEY=0` only if you
  intentionally want an open `/ask` endpoint. Tool endpoints remain public and
  read-only.
- In-memory rate limits per client IP:
  - `/ask`: 10 requests/minute (`INSTINCT_ASK_RATE_LIMIT`)
  - tool calls: 120 requests/minute (`INSTINCT_TOOL_RATE_LIMIT`)
- Responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining` and
  `X-RateLimit-Reset`. A `429` includes `Retry-After`.
- Request bodies are capped at 32 KB.
- CORS defaults to `*` because the data is public and read-only. Restrict it with
  `INSTINCT_ALLOWED_ORIGINS=https://instinct.example.com`.
- Behind Coolify/Traefik, `INSTINCT_TRUST_PROXY=1` (the default) uses the first
  `X-Forwarded-For` address for rate limiting. Set it to `0` if the process is
  exposed directly.

---

## Run locally

```bash
npm install
npm run build          # creates dist/ for the static side
npm run api            # http://localhost:8080
```

In another terminal:

```bash
npm run dev            # Vite proxies /api and /healthz to :8080
```

With a provider key:

```bash
NVIDIA_API_KEY=nvapi-... npm run api
```

Or test the whole loop without a key:

```bash
npm run check:tools
npm run check:agent
npm run check:provider
npm run check:api       # starts the server with a mock provider
```

---

## Deploying on Coolify

The API and the SPA share one container and one domain. The runtime listens on
port **8080** (not 80). In the Coolify application:

1. Set **Ports Exposes** to `8080`.
2. Set the health check to `/healthz` on port `8080`.
3. Add the provider keys as **runtime** environment variables (not build args):
   `NVIDIA_API_KEY` and/or `OPENROUTER_API_KEY`.
4. Optionally add `INSTINCT_API_KEY` and restrict `INSTINCT_ALLOWED_ORIGINS`.
5. Redeploy.

Do not commit keys. The `.env` file is excluded from Docker builds and Git.

For an external Instinct agent, point it at:

```
https://mf.vishalojha.me/api/instinct
```

and give it the tool catalog from `GET /api/instinct/tools`. That keeps
inference on Instinct's side while the LevelLens numbers stay deterministic.
