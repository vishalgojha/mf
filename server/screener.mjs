// LevelLens stock screener endpoint.
//
// Fetches delayed NSE equity fundamentals via yfinance (Python bridge)
// and returns a normalized, comparable payload. No API key required.
//
// Usage:
//   GET /api/screener?symbols=RELIANCE.NS,TCS.NS,INFY.NS

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PYTHON_SCRIPT = new URL("./screener_fetcher.py", import.meta.url).pathname;

const buckets = new Map();

const rateLimit = (key, limit, windowMs = 60000) => {
  const now = Date.now();
  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
};

const clientIp = (req) => req.socket.remoteAddress || "unknown";

export const handleScreener = async (req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const symbolsParam = url.searchParams.get("symbols");

  if (!symbolsParam) {
    res.writeHead(400, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ error: "Provide ?symbols=RELIANCE.NS,TCS.NS" }));
    return;
  }

  const ip = clientIp(req);
  const rate = rateLimit(`${ip}:screener`, 30);
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
  if (!rate.allowed) {
    res.writeHead(429, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Screener rate limit exceeded." }));
    return;
  }

  const symbols = symbolsParam
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

  if (symbols.length === 0) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "No valid symbols provided." }));
    return;
  }

  try {
    const { stdout } = await execFileAsync("python3", [PYTHON_SCRIPT, ...symbols], {
      maxBuffer: 1024 * 1024,
      timeout: 60000,
    });
    const json = JSON.parse(stdout);

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(
      JSON.stringify({
        symbols,
        results: json.results || [],
        count: json.count || 0,
        updated: new Date().toISOString(),
      })
    );
  } catch (error) {
    console.error("[screener]", error.message);
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Upstream data unavailable." }));
  }
};
