// LevelLens Instinct API + static site.
//
// One process serves the built SPA and the Instinct endpoints, so the app and
// the API share an origin. The deterministic tool endpoints need no model key;
// /ask additionally needs NVIDIA_API_KEY or OPENROUTER_API_KEY.

import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AgentError, runAgent } from "./agent.mjs";
import { loadData } from "./data.mjs";
import {
  AllProvidersFailedError,
  NoProviderError,
  getProviderInfo,
} from "./providers.mjs";
import { createStaticHandler } from "./static.mjs";
import { ToolError, createToolRegistry } from "./tools.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || process.env.INSTINCT_PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";
const STATIC_DIR = process.env.INSTINCT_STATIC_DIR
  ? path.resolve(process.env.INSTINCT_STATIC_DIR)
  : path.join(repoRoot, "dist");
const API_KEY = process.env.INSTINCT_API_KEY || "";
const REQUIRE_ONE_TIME_KEY = process.env.INSTINCT_REQUIRE_KEY !== "0";
const ONE_TIME_KEY_TTL_MS = Number(process.env.INSTINCT_ONE_TIME_KEY_TTL_MS || 10 * 60 * 1000);
const TRUST_PROXY = process.env.INSTINCT_TRUST_PROXY !== "0";
const CORS_ORIGINS = (process.env.INSTINCT_ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const MAX_BODY_BYTES = Number(process.env.INSTINCT_MAX_BODY_BYTES || 32768);
const ASK_LIMIT = Number(process.env.INSTINCT_ASK_RATE_LIMIT || 10);
const TOOL_LIMIT = Number(process.env.INSTINCT_TOOL_RATE_LIMIT || 120);

const data = loadData();
const registry = createToolRegistry(data.toolkit);
const staticHandler = createStaticHandler({ root: STATIC_DIR });

const errorResponse = (description) => ({
  description,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: {
          error: { type: "string" },
          code: { type: "string" },
          requestId: { type: "string" },
        },
      },
    },
  },
});

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "LevelLens Instinct API",
    version: "1.0.0",
    description:
      "Deterministic mutual-fund and Nifty 50 tools for Instinct AI, plus an optional tool-calling agent.",
  },
  servers: [{ url: "https://mf.vishalojha.me" }],
  paths: {
    "/healthz": {
      get: { summary: "Plain-text health check.", responses: { 200: { description: "ok" } } },
    },
    "/api/instinct/health": {
      get: {
        summary: "Data coverage, provider status and uptime.",
        responses: { 200: { description: "Service status." } },
      },
    },
    "/api/instinct/tools": {
      get: {
        summary: "List tools with JSON Schemas.",
        responses: { 200: { description: "Tool catalog." } },
      },
    },
    "/api/instinct/keys": {
      post: {
        summary: "Issue one short-lived API key for one hosted-agent request.",
        responses: {
          200: { description: "One-time bearer key. The key is returned only once." },
          429: errorResponse("Key issuance rate limit exceeded."),
        },
      },
    },
    "/api/instinct/models": {
      get: {
        summary: "Configured model providers. Keys are never returned.",
        responses: { 200: { description: "Provider metadata." } },
      },
    },
    "/api/instinct/ask": {
      post: {
        summary: "Run the bounded tool-calling agent.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["question"],
                properties: {
                  question: { type: "string", minLength: 1, maxLength: 2000 },
                  from: { type: "number" },
                  to: { type: "number" },
                  category: { type: "string" },
                  provider: { type: "string", enum: ["auto", "nvidia", "openrouter"] },
                  model: { type: "string" },
                  includeToolResults: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "Grounded answer with a tool trace." },
          400: errorResponse("Invalid question or arguments."),
          401: errorResponse("Bearer token missing or invalid."),
          429: errorResponse("Rate limit exceeded."),
          502: errorResponse("All configured providers failed."),
          503: errorResponse("No provider key configured; use the tool endpoints."),
        },
      },
    },
    ...Object.fromEntries(
      registry.list().map((tool) => [
        `/api/instinct/tools/${tool.name}`,
        {
          post: {
            summary: tool.description,
            requestBody: {
              required: true,
              content: { "application/json": { schema: tool.parameters } },
            },
            responses: {
              200: { description: "Tool result with a human-readable summary." },
              400: errorResponse("Unknown tool or invalid arguments."),
              429: errorResponse("Rate limit exceeded."),
            },
          },
        },
      ])
    ),
  },
};

class HttpError extends Error {
  constructor(status, message, code = "http_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const jsonResponse = (res, status, payload, requestId) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Request-Id": requestId,
    "Access-Control-Expose-Headers": "X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
  });
  res.end(body);
};

const textResponse = (res, status, body) => {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
};

const applyCors = (req, res) => {
  const origin = req.headers.origin;
  const wildcard = CORS_ORIGINS.includes("*");
  const allowed = wildcard
    ? "*"
    : origin && CORS_ORIGINS.includes(origin)
      ? origin
      : null;

  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
    if (allowed !== "*") res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Request-Id");
  res.setHeader("Access-Control-Max-Age", "86400");
};

const clientIp = (req) => {
  if (TRUST_PROXY) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0].trim();
    }
  }
  return req.socket.remoteAddress || "unknown";
};

const buckets = new Map();
const oneTimeKeys = new Map();

const hashKey = (value) => crypto.createHash("sha256").update(value).digest("hex");

const issueOneTimeKey = () => {
  const key = `ll_${crypto.randomBytes(24).toString("base64url")}`;
  const expiresAt = Date.now() + ONE_TIME_KEY_TTL_MS;
  oneTimeKeys.set(hashKey(key), { expiresAt, used: false });
  return { key, expiresAt };
};

const consumeOneTimeKey = (value) => {
  if (!value) return false;
  const record = oneTimeKeys.get(hashKey(value));
  if (!record || record.used || record.expiresAt <= Date.now()) {
    if (record?.expiresAt <= Date.now()) oneTimeKeys.delete(hashKey(value));
    return false;
  }
  record.used = true;
  return true;
};

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
    limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
};

const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  for (const [key, record] of oneTimeKeys) {
    if (record.expiresAt <= now || record.used) oneTimeKeys.delete(key);
  }
}, 5 * 60 * 1000);
cleanupTimer.unref();

const applyRateHeaders = (res, rate) => {
  res.setHeader("X-RateLimit-Limit", String(rate.limit));
  res.setHeader("X-RateLimit-Remaining", String(rate.remaining));
  res.setHeader("X-RateLimit-Reset", String(Math.ceil(rate.resetAt / 1000)));
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
  }
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    let raw = "";

    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      size += Buffer.byteLength(chunk);
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, `Request body exceeds ${MAX_BODY_BYTES} bytes.`, "body_too_large"));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on("end", () => {
      if (raw.trim() === "") {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new HttpError(400, "JSON body must be an object.", "invalid_json"));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new HttpError(400, "Request body is not valid JSON.", "invalid_json"));
      }
    });
    req.on("error", (error) => reject(error));
    req.on("aborted", () => reject(new HttpError(400, "Request aborted.", "aborted")));
  });

const safeEqual = (left, right) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const authorizeAsk = (req) => {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return !REQUIRE_ONE_TIME_KEY && !API_KEY ? { ok: true, permanent: false } : { ok: false };
  if (API_KEY && safeEqual(match[1], API_KEY)) return { ok: true, permanent: true };
  return { ok: consumeOneTimeKey(match[1]), permanent: false };
};

const requestIdFor = (req) => {
  const incoming = req.headers["x-request-id"];
  return typeof incoming === "string" && /^[a-zA-Z0-9._-]{1,64}$/.test(incoming)
    ? incoming
    : crypto.randomUUID();
};

const handleApi = async (req, res, pathname, requestId) => {
  applyCors(req, res);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "X-Request-Id": requestId });
    res.end();
    return true;
  }

  if (pathname === "/api/instinct") {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
    jsonResponse(
      res,
      200,
      {
        service: "levellens-instinct",
        docs: "INSTINCT.md",
        endpoints: {
          health: "GET /api/instinct/health",
          tools: "GET /api/instinct/tools",
          callTool: "POST /api/instinct/tools/:name",
          models: "GET /api/instinct/models",
          openapi: "GET /api/instinct/openapi.json",
          ask: "POST /api/instinct/ask",
          issueKey: "POST /api/instinct/keys",
        },
        data: data.status,
      },
      requestId
    );
    return true;
  }

  if (pathname === "/api/instinct/health") {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
    jsonResponse(
      res,
      200,
      {
        status: "ok",
        service: "levellens-instinct",
        uptimeSeconds: Math.round(process.uptime()),
        data: data.status,
        providers: getProviderInfo(),
        authRequiredForAsk: Boolean(API_KEY),
      },
      requestId
    );
    return true;
  }

  if (pathname === "/api/instinct/tools") {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
    jsonResponse(res, 200, { tools: registry.list(), data: data.status }, requestId);
    return true;
  }

  if (pathname === "/api/instinct/models") {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
    jsonResponse(res, 200, getProviderInfo(), requestId);
    return true;
  }

  if (pathname === "/api/instinct/keys") {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
    const rate = rateLimit(`${clientIp(req)}:keys`, ASK_LIMIT);
    applyRateHeaders(res, rate);
    if (!rate.allowed) throw new HttpError(429, "Key issuance rate limit exceeded.", "rate_limited");
    const issued = issueOneTimeKey();
    jsonResponse(
      res,
      200,
      {
        key: issued.key,
        tokenType: "Bearer",
        uses: 1,
        expiresAt: new Date(issued.expiresAt).toISOString(),
        message: "This key is shown once and expires after one /ask request or 10 minutes.",
      },
      requestId
    );
    return true;
  }

  if (pathname === "/api/instinct/openapi.json") {
    if (req.method !== "GET") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
    jsonResponse(res, 200, openApiDocument, requestId);
    return true;
  }

  if (pathname.startsWith("/api/instinct/tools/")) {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
    const rate = rateLimit(`${clientIp(req)}:tools`, TOOL_LIMIT);
    applyRateHeaders(res, rate);
    if (!rate.allowed) throw new HttpError(429, "Tool rate limit exceeded.", "rate_limited");

    let name;
    let args;
    try {
      name = decodeURIComponent(pathname.slice("/api/instinct/tools/".length));
      args = await readJsonBody(req);
    } catch (error) {
      if (error instanceof URIError) {
        throw new HttpError(400, "Malformed tool name.", "invalid_tool_name");
      }
      throw error;
    }
    const execution = registry.execute(name, args);

    jsonResponse(
      res,
      200,
      {
        tool: name,
        ok: execution.ok,
        summary: execution.summary,
        result: execution.result,
        requestId,
      },
      requestId
    );
    return true;
  }

  if (pathname === "/api/instinct/ask") {
    if (req.method !== "POST") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
    const authorization = authorizeAsk(req);
    if (!authorization.ok) {
      res.setHeader("WWW-Authenticate", "Bearer");
      throw new HttpError(401, "Missing, expired, or already-used bearer token.", "unauthorized");
    }

    const rate = rateLimit(`${clientIp(req)}:ask`, ASK_LIMIT);
    applyRateHeaders(res, rate);
    if (!rate.allowed) throw new HttpError(429, "Ask rate limit exceeded.", "rate_limited");

    const body = await readJsonBody(req);

    if (typeof body.question !== "string" || body.question.trim() === "") {
      throw new HttpError(400, "`question` must be a non-empty string.", "invalid_question");
    }
    if (body.question.length > 2000) {
      throw new HttpError(400, "`question` is too long (maximum 2000 characters).", "invalid_question");
    }
    for (const key of ["from", "to"]) {
      if (body[key] !== undefined && (typeof body[key] !== "number" || !Number.isFinite(body[key]))) {
        throw new HttpError(400, `\`${key}\` must be a number when provided.`, "invalid_question");
      }
    }
    if (body.category !== undefined && typeof body.category !== "string") {
      throw new HttpError(400, "`category` must be a string when provided.", "invalid_question");
    }

    const controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort(new Error("Client disconnected"));
    });

    const result = await runAgent({
      question: body.question,
      registry,
      status: data.status,
      context: { from: body.from, to: body.to, category: body.category },
      provider: typeof body.provider === "string" ? body.provider : "auto",
      model: typeof body.model === "string" ? body.model : null,
      includeToolResults: body.includeToolResults === true,
      signal: controller.signal,
    });

    jsonResponse(
      res,
      200,
      {
        ...result,
        requestId,
        data: data.status,
        disclaimer: "Educational analysis of bundled historical NAV data. Not investment advice.",
      },
      requestId
    );
    return true;
  }

  if (pathname.startsWith("/api/")) {
    throw new HttpError(404, "Unknown API route.", "not_found");
  }

  return false;
};

const mapError = (error) => {
  if (error instanceof HttpError) {
    return { status: error.status, payload: { error: error.message, code: error.code } };
  }
  if (error instanceof NoProviderError) {
    return {
      status: 503,
      payload: { error: error.message, code: error.code },
    };
  }
  if (error instanceof AllProvidersFailedError) {
    return {
      status: 502,
      payload: {
        error: error.message,
        code: error.code,
        providers: error.errors,
      },
    };
  }
  if (error instanceof ToolError) {
    return { status: 400, payload: { error: error.message, code: error.code } };
  }
  if (error instanceof AgentError) {
    return { status: 400, payload: { error: error.message, code: error.code } };
  }
  if (error?.name === "AbortError") {
    return { status: 499, payload: { error: "Request cancelled.", code: "cancelled" } };
  }
  return {
    status: 500,
    payload: { error: "Internal server error.", code: "internal_error" },
  };
};

const server = http.createServer(async (req, res) => {
  const requestId = requestIdFor(req);
  const started = Date.now();
  let pathname = "/";

  try {
    pathname = new URL(req.url || "/", "http://localhost").pathname;
  } catch {
    textResponse(res, 400, "Bad request\n");
    return;
  }

  res.on("finish", () => {
    if (pathname.startsWith("/api/")) {
      console.log(
        `${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms ip=${clientIp(req)} id=${requestId}`
      );
    }
  });

  try {
    if (pathname === "/healthz") {
      textResponse(res, 200, "ok\n");
      return;
    }

    const handled = await handleApi(req, res, pathname, requestId);
    if (handled) return;

    staticHandler(req, res);
  } catch (error) {
    const mapped = mapError(error);

    if (mapped.status >= 500) {
      console.error(`[${requestId}] ${req.method} ${pathname}`, error);
    }

    if (res.headersSent) {
      res.destroy();
      return;
    }

    applyCors(req, res);
    jsonResponse(res, mapped.status, { ...mapped.payload, requestId }, requestId);
  }
});

server.requestTimeout = Number(process.env.INSTINCT_REQUEST_TIMEOUT_MS || 180000);
server.headersTimeout = 65000;

server.listen(PORT, HOST, () => {
  const providers = getProviderInfo();
  console.log(`LevelLens listening on http://${HOST}:${PORT}`);
  console.log(`Static root: ${STATIC_DIR}`);
  console.log(`Data: ${data.status.nifty.rows} Nifty rows, ${data.status.funds.count} funds (${data.dataDir})`);
  console.log(
    `Providers: ${providers.providers
      .map((provider) => `${provider.name}=${provider.configured ? "configured" : "unset"}`)
      .join(", ")}`
  );
  console.log(`Ask auth: ${API_KEY ? "bearer token required" : "open (set INSTINCT_API_KEY to protect /ask)"}`);
});

const shutdown = (signal) => {
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
