// Refresh public/data/funds.json with daily NAV history for the comparison
// universe. The browser then loads one small file instead of calling MFAPI.in
// once instead of one request per fund on every visit.
//
//   npm run update:funds              # default concurrency
//   npm run update:funds -- 4         # ...with 4 parallel downloads
//
// Only the range covered by the bundled Nifty snapshot is kept (plus a buffer
// so a window that starts on the first Nifty day still has a prior NAV). New
// data is merged with the existing snapshot, so a failed fetch never drops a
// fund that was already present.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FUND_UNIVERSE } from "../src/data/funds.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const niftyFile = process.env.NIFTY_OUT || path.join(root, "public", "data", "nifty50.json");
const outputFile = process.env.FUNDS_OUT || path.join(root, "public", "data", "funds.json");

const concurrency = Math.max(1, Number(process.argv[2]) || 6);
const API = (process.env.MFAPI_URL || "https://api.mfapi.in/mf/").replace(/\/?$/, "/");
const bufferDays = 60;
const DAY_MS = 24 * 60 * 60 * 1000;

const isoToTime = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
};

const dmyToIso = (date) => {
  const [day, month, year] = date.split("-");
  return `${year}-${month}-${day}`;
};

const readJson = async (file) => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
};

const nifty = await readJson(niftyFile);
const firstNifty = nifty?.rows?.[0]?.[0];

if (!firstNifty) {
  console.error(`No Nifty snapshot at ${path.relative(process.cwd(), niftyFile)}. Run npm run update:nifty first.`);
  process.exit(1);
}

const cutoffTime = isoToTime(firstNifty) - bufferDays * DAY_MS;
const existing = (await readJson(outputFile))?.funds || {};

const fetchFund = async (code) => {
  const url = `${API}${code}?_=${Date.now()}`;
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const schemeName = payload?.meta?.scheme_name || null;
      const rows = Array.isArray(payload?.data) ? payload.data : [];

      const byDate = new Map();
      rows.forEach((row) => {
        const iso = dmyToIso(row.date);
        if (!iso || isoToTime(iso) < cutoffTime) return;
        const nav = Number(row.nav);
        if (!Number.isFinite(nav) || nav <= 0) return;
        byDate.set(iso, nav);
      });

      const navs = [...byDate.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([iso, nav]) => [iso.slice(8, 10) + "-" + iso.slice(5, 7) + "-" + iso.slice(0, 4), nav]);

      if (navs.length === 0) throw new Error("no NAV rows in coverage window");
      return { schemeName, navs };
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 800 * attempt));
    }
  }

  throw lastError;
};

const funds = {};
const failures = [];
let next = 0;
let completed = 0;

const worker = async () => {
  while (next < FUND_UNIVERSE.length) {
    const fund = FUND_UNIVERSE[next];
    next += 1;
    const code = String(fund.code);
    try {
      funds[code] = await fetchFund(code);
    } catch (error) {
      failures.push({ code, name: fund.name, reason: error?.message || String(error) });
      if (existing[code]) funds[code] = existing[code];
    }

    completed += 1;
    process.stdout.write(`  ${completed}/${FUND_UNIVERSE.length} ${fund.name}${funds[code] ? "" : " (failed)"}\n`);
  }
};

console.log(
  `Refreshing NAV history for ${FUND_UNIVERSE.length} funds ` +
    `(from ${new Date(cutoffTime).toISOString().slice(0, 10)} via MFAPI.in)…`
);

await Promise.all(Array.from({ length: concurrency }, worker));

const codes = Object.keys(funds);
if (codes.length === 0) {
  console.error("No fund data available from MFAPI.in and no existing snapshot to keep.");
  process.exit(1);
}

const allDates = codes.flatMap((code) => funds[code].navs.map(([date]) => dmyToIso(date)));
const payload = {
  source: "MFAPI.in",
  fetchedAt: new Date().toISOString().slice(0, 19) + "Z",
  coverage: {
    from: allDates.reduce((min, date) => (date < min ? date : min), allDates[0]),
    to: allDates.reduce((max, date) => (date > max ? date : max), allDates[0]),
  },
  funds,
};

await fs.mkdir(path.dirname(outputFile), { recursive: true });
await fs.writeFile(outputFile, JSON.stringify(payload));

const bytes = (await fs.stat(outputFile)).size;
console.log(
  `Wrote ${codes.length} funds to ${path.relative(process.cwd(), outputFile)} ` +
    `(${payload.coverage.from} → ${payload.coverage.to}, ${(bytes / 1024 / 1024).toFixed(2)} MB).`
);

if (failures.length > 0) {
  console.warn(`${failures.length} fund(s) failed; existing snapshot rows were kept where available:`);
  failures.forEach(({ code, name, reason }) => console.warn(`  ${code} ${name}: ${reason}`));
}
