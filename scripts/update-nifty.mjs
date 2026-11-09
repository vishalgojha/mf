// Refresh public/data/nifty50.json with daily Nifty 50 closes.
//
//   npm run update:nifty             # last 3 years
//   npm run update:nifty -- 730      # last 730 calendar days
//   npm run update:nifty -- 730 16   # ...with 16 parallel downloads
//
// Sources (both free, no API key):
//   1. Yahoo Finance chart API - one request for the whole range.
//   2. NSE index archive - one CSV per trading day, used as a fallback:
//      https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv
//
// New rows are merged with the existing snapshot, so a partial or rate-limited
// response never deletes newer data.

import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputFile =
  process.env.NIFTY_OUT || path.join(__dirname, "..", "public", "data", "nifty50.json");

const days = Number(process.argv[2]) || 1095;
const concurrency = Number(process.argv[3]) || 10;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const pad = (value) => String(value).padStart(2, "0");
const toNseDate = (date) => `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
const toIsoDate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const formatIN = (n) =>
  n.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });

async function fetchFromYahoo() {
  const years = Math.max(1, Math.ceil(days / 365));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?range=${years}y&interval=1d`;

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "*/*" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const payload = await response.json();
    const result = payload?.chart?.result?.[0];
    const timestamps = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];

    const rows = [];
    for (let i = 0; i < timestamps.length; i += 1) {
      if (!Number.isFinite(closes[i])) continue;
      const date = new Date((timestamps[i] + result.meta.gmtoffset) * 1000);
      rows.push([toIsoDate(date), Math.round(closes[i] * 100) / 100]);
    }

    return rows;
  } catch (error) {
    console.warn(`Yahoo Finance unavailable (${error.message}); falling back to NSE archives.`);
    return [];
  }
}

async function download(url) {
  try {
    const { stdout } = await execFileAsync("curl", ["-sS", "-m", "25", "-A", USER_AGENT, url], {
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    });
    return stdout;
  } catch (error) {
    if (error.code === "ENOENT") {
      const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
      return response.ok ? response.text() : "";
    }
    return "";
  }
}

async function fetchFromNse() {
  const dates = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);

  for (let offset = days; offset >= 0; offset -= 1) {
    const date = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6) dates.push(date);
  }

  const rows = [];
  let completed = 0;
  let next = 0;

  const fetchDay = async (date) => {
    const url = `https://nsearchives.nseindia.com/content/indices/ind_close_all_${toNseDate(date)}.csv`;
    const text = await download(url);
    if (!text) return null;

    const line = text
      .split(/\r?\n/)
      .find((row) => row.trim().toLowerCase().startsWith("nifty 50,"));
    if (!line) return null;

    const close = Number(line.split(",")[5]);
    if (!Number.isFinite(close) || close <= 0) return null;

    return [toIsoDate(date), Math.round(close * 100) / 100];
  };

  const worker = async () => {
    while (next < dates.length) {
      const date = dates[next];
      next += 1;
      const row = await fetchDay(date);
      if (row) rows.push(row);

      completed += 1;
      if (completed % 50 === 0 || completed === dates.length) {
        process.stdout.write(`  checked ${completed}/${dates.length} days (${rows.length} new closes)\n`);
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
  return rows;
}

// Merge with the bundled snapshot so newer rows survive.
let existing = null;
try {
  existing = JSON.parse(await fs.readFile(outputFile, "utf8"));
} catch {
  // No snapshot yet.
}

const merged = new Map();
(existing?.rows || []).forEach(([date, close]) => merged.set(date, close));

console.log(`Refreshing Nifty 50 daily closes for the last ${days} days…`);
let source = "Yahoo Finance";

let rows = await fetchFromYahoo();
if (rows.length === 0) {
  rows = await fetchFromNse();
  source = "NSE India (ind_close_all archives)";
}

rows.forEach(([date, close]) => merged.set(date, close));

const allRows = [...merged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));

if (allRows.length === 0) {
  console.error("No data available from Yahoo Finance or NSE. Try again later.");
  process.exit(1);
}

const newLatest = rows.reduce((max, row) => (row[0] > max ? row[0] : max), "");
const existingLatest = existing?.rows?.[existing.rows.length - 1]?.[0] || "";
const keptNewer = existingLatest > newLatest;

if (rows.length === 0) {
  source = existing?.source || "existing snapshot";
}

const payload = {
  symbol: "^NSEI",
  name: "NIFTY 50",
  source: keptNewer ? `${source} + existing snapshot` : source,
  fetchedAt: new Date().toISOString().slice(0, 19) + "Z",
  rows: allRows,
};

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, JSON.stringify(payload));

if (rows.length === 0) {
  console.warn("No new rows were downloaded (sources may be rate-limiting). Existing snapshot kept.");
}

console.log(
  `Wrote ${allRows.length} closes to ${path.relative(process.cwd(), outputFile)} ` +
    `(${allRows[0][0]} → ${allRows[allRows.length - 1][0]}, last close ${formatIN(allRows[allRows.length - 1][1])}).`
);
