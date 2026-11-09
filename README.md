# LevelLens

LevelLens is a free, open-source way to look at Indian mutual funds. Search a fund house and chart a scheme's historical NAV, or use **Nifty range performance** to see how 62 popular Direct Plan funds performed between two Nifty 50 levels.

The range tab answers a specific question: *when the Nifty moved from level A to level B, who beat it?* Pick `22,600 → 25,000` and the app finds the most recent window where the index travelled between those closes, then ranks funds over exactly those dates with returns, alpha vs Nifty, category colours, and a fund-by-fund table.

![Nifty range performance](demo/nifty-range-performance.jpeg)
## Demo
![Usage demo](demo/india-mutual-fund.gif)

## How to use
1. Type the name of the Fund house (eg: Axis, HDFC, SBI, ICICI etc.) or the type of fund (equity, debt, gold etc.) you want to search for in the search bar and then select a fund from the search results.
2. The chart will show the historical NAV of the selected fund. You can hover over the chart to see the NAV for a specific date. You can also zoom in on a specific time period by selecting a date range.
3. You can download the historical NAV data for the fund in CSV format by clicking the download button.

## Features
1. Search autocomplete for Mutual Fund names.
2. Historical NAV chart with tooltips and date range selector.
3. Color coded chart to indicate positive/negative NAV change.
4. Download historical NAV data in CSV format.
5. Nifty range performance: compare fund returns across a Nifty 50 level move (e.g. 22,600 → 25,000), with a highlighted Nifty chart, ranked return bars, and a fund-by-fund table.
6. Bundled data snapshots: the range tab loads one `funds.json` file instead of calling MFAPI.in 62 times per visit, and flags funds whose NAV is missing at a window boundary.

## Want to run it locally?
1. Clone the repository.
2. Run `npm install` to install the dependencies.
3. Copy `.env.example` to `.env` and keep (or change) the free MFAPI.in base URL:
   ```
   VITE_MFAPI_URL=https://api.mfapi.in/mf/
   ```
4. Run `npm run dev` to start the development server.

### Nifty 50 data
The Nifty 50 daily closes used by the range-performance tab are bundled in `public/data/nifty50.json`, so the app works out of the box without any API key or CORS proxy. To refresh the snapshot:

```
npm run update:nifty            # last 3 years
npm run update:nifty -- 730     # last 730 calendar days
```

The refresh script tries Yahoo Finance first and falls back to NSE's free `ind_close_all` daily archives. It merges new rows into the existing snapshot, so a rate-limited or blocked request never deletes newer data.

### Fund NAV data
The 62-fund comparison universe is bundled in `public/data/funds.json`, so a visit makes one request instead of 62. To refresh it:

```
npm run update:funds            # default concurrency (6)
npm run update:funds -- 4       # ...with 4 parallel downloads
```

The script keeps only the period covered by the Nifty snapshot (plus a buffer), merges with the existing file, and keeps old rows for any fund whose fetch fails. Update Nifty first if you want the fund coverage window to move forward.

### Checks
```
npm run check:returns
```
Covers full coverage, a fund launched after the window start (must be excluded, not measured from its first NAV), a stale end NAV, and empty history.

### PDF report
Generate a standalone performance report for a level range:

```
python3 scripts/build-report.py
python3 scripts/build-report.py --from 22600 --to 25000 --out reports/custom.pdf
```

The PDF is rendered with headless Chrome and written to `reports/nifty-fund-performance-22600-25000.pdf`.

## Deploying
The app is a static SPA with no backend. It includes a multi-stage `Dockerfile` and an `nginx.conf` (SPA fallback, gzip, asset caching, `/healthz`), so it runs on any Docker host.

For Hetzner with Coolify, follow [COOLIFY.md](COOLIFY.md). The app is deployed from `vishalgojha/mf` (`main`) at `https://mf.vishalojha.me`.

Quick local container test:

```
docker build -t levellens .
docker run --rm -p 8080:80 levellens
```

## Site link
## https://mf.vishalojha.me/