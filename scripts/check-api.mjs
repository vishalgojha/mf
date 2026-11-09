// End-to-end HTTP checks for the Instinct API and the static server.
//   npm run build && npm run check:api
//
// Starts the real server with the mock provider, so no model keys are needed.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const freePort = () =>
  new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const logs = [];

const child = spawn(process.execPath, ["server/index.mjs"], {
  cwd: repoRoot,
  env: {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(port),
    INSTINCT_ENABLE_MOCK: "1",
    INSTINCT_STATIC_DIR: path.join(repoRoot, "dist"),
    INSTINCT_ASK_RATE_LIMIT: "100",
    INSTINCT_TOOL_RATE_LIMIT: "100",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

child.stdout.on("data", (chunk) => logs.push(chunk.toString()));
child.stderr.on("data", (chunk) => logs.push(chunk.toString()));

const stop = () => {
  if (!child.killed) child.kill("SIGTERM");
};

const waitForServer = async () => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early with code ${child.exitCode}.\n${logs.join("")}`);
    }
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return;
    } catch {
      // not ready yet
    }
    await delay(100);
  }
  throw new Error(`Server did not become ready.\n${logs.join("")}`);
};

const post = (pathname, body, headers = {}) =>
  fetch(`${base}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`FAIL ${name}: ${error.message}`);
  }
};

try {
  assert.ok(
    fs.existsSync(path.join(repoRoot, "dist", "index.html")),
    "dist/index.html is missing; run npm run build first"
  );

  await waitForServer();

  await check("serves /healthz", async () => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
    assert.equal((await response.text()).trim(), "ok");
  });

  await check("reports data and provider status", async () => {
    const response = await fetch(`${base}/api/instinct/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.data.funds.count, 62);
    assert.equal(body.data.nifty.rows > 500, true);
    assert.equal(body.providers.mode, "agent");
    assert.ok(body.providers.providers.some((provider) => provider.name === "mock"));
  });

  await check("lists the tool surface", async () => {
    const response = await fetch(`${base}/api/instinct/tools`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.tools.length, 7);
    assert.ok(body.tools.every((tool) => tool.parameters.type === "object"));
  });

  await check("calls resolve_window directly", async () => {
    const response = await post("/api/instinct/tools/resolve_window", {
      from: 22600,
      to: 25000,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.result.status, "ready");
    assert.equal(body.result.startDate, "2026-10-23");
    assert.equal(body.result.endDate, "2026-11-06");
    assert.match(body.summary, /10\.75%/);
  });

  await check("calls rank_funds with a category filter", async () => {
    const response = await post("/api/instinct/tools/rank_funds", {
      from: 22600,
      to: 25000,
      category: "Index",
      limit: 3,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.result.funds.length, 3);
    assert.ok(body.result.funds.every((fund) => fund.category === "Index"));
  });

  await check("rejects invalid tool arguments with 400", async () => {
    const response = await post("/api/instinct/tools/rank_funds", { from: 22600 });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "invalid_arguments");
    assert.match(body.error, /to is required/);
  });

  await check("rejects unknown tools with 400", async () => {
    const response = await post("/api/instinct/tools/nope", {});
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "unknown_tool");
  });

  await check("runs /ask through the mock provider", async () => {
    const response = await post("/api/instinct/ask", {
      question: "How did funds do between 22,600 and 25,000?",
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.match(body.answer, /Mock answer/);
    assert.equal(body.provider, "mock");
    assert.equal(body.trace.length, 1);
    assert.equal(body.trace[0].name, "resolve_window");
    assert.equal(body.trace[0].ok, true);
    assert.equal(body.window.startDate, "2026-10-23");
    assert.equal(body.disclaimer.includes("Not investment advice"), true);
    assert.ok(body.requestId);
  });

  await check("can include full tool results from /ask", async () => {
    const response = await post("/api/instinct/ask", {
      question: "Resolve 22,600 to 25,000",
      includeToolResults: true,
      from: 22600,
      to: 25000,
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.trace[0].result.status, "ready");
    assert.equal(body.trace[0].result.niftyReturn > 10.7, true);
  });

  await check("validates the /ask question", async () => {
    const response = await post("/api/instinct/ask", { question: "" });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, "invalid_question");
  });

  await check("returns provider metadata without keys", async () => {
    const response = await fetch(`${base}/api/instinct/models`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.ok(Array.isArray(body.providers));
    assert.equal(JSON.stringify(body).includes("NVIDIA_API_KEY="), false);
  });

  await check("serves an OpenAPI document", async () => {
    const response = await fetch(`${base}/api/instinct/openapi.json`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.openapi, "3.1.0");
    assert.ok(body.paths["/api/instinct/tools/rank_funds"]);
    assert.equal(
      body.paths["/api/instinct/tools/rank_funds"].post.requestBody.content["application/json"]
        .schema.required.includes("to"),
      true
    );
  });

  await check("answers CORS preflight", async () => {
    const response = await fetch(`${base}/api/instinct/ask`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://example.com",
        "Access-Control-Request-Method": "POST",
      },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
  });

  await check("serves the SPA", async () => {
    const response = await fetch(`${base}/`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<title>LevelLens/);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });

  await check("serves the bundled fund snapshot", async () => {
    const response = await fetch(`${base}/data/funds.json`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(Object.keys(body.funds).length, 62);
    assert.equal(response.headers.get("cache-control"), "public, max-age=3600");
  });

  await check("falls back to index.html for client routes", async () => {
    const response = await fetch(`${base}/nifty-range`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<div id="root">/);
  });

  await check("returns JSON 404 for unknown API routes", async () => {
    const response = await fetch(`${base}/api/instinct/nope`);
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.equal(body.code, "not_found");
  });

  await check("blocks path traversal", async () => {
    const response = await fetch(`${base}/..%2f..%2fpackage.json`);
    assert.ok([403, 404].includes(response.status));
  });
} catch (error) {
  console.error(`\nAPI check crashed: ${error.message}`);
  if (logs.length > 0) console.error(logs.join("").slice(-4000));
  stop();
  process.exit(1);
} finally {
  stop();
}

const failed = results.filter((result) => !result.ok);
if (failed.length > 0) {
  console.error(`\n${failed.length} API check(s) failed.`);
  if (logs.length > 0) console.error(logs.join("").slice(-4000));
  await delay(200);
  process.exit(1);
}

console.log(`\nAll ${results.length} API checks passed.`);
await delay(200);
process.exit(0);
