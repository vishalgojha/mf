// Minimal static file server for the built SPA.
//
// The API and the site run in one Node process so Instinct can use the same
// origin (no second domain or CORS setup). Behaviour mirrors the old nginx
// config: SPA fallback, gzip, immutable hashed assets, short cache for /data.

import fs from "node:fs";
import path from "node:path";
import { createGzip } from "node:zlib";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const COMPRESSIBLE = new Set([
  "text/html",
  "text/css",
  "text/javascript",
  "application/json",
  "image/svg+xml",
]);

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

const cacheControlFor = (pathname) => {
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  if (pathname.startsWith("/data/")) return "public, max-age=3600";
  if (pathname === "/" || pathname === "/index.html") return "no-cache";
  return "public, max-age=86400";
};

const isFile = (file) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};

export const createStaticHandler = ({ root }) => {
  const resolvedRoot = path.resolve(root);

  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
      res.end("Method not allowed\n");
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad request\n");
      return;
    }

    if (pathname.includes("\0")) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Bad request\n");
      return;
    }

    const relative = pathname.replace(/^\/+/, "");
    let filePath = path.resolve(resolvedRoot, relative || "index.html");
    let isSpaFallback = false;

    if (filePath !== resolvedRoot && !filePath.startsWith(`${resolvedRoot}${path.sep}`)) {
      res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Forbidden\n");
      return;
    }

    if (!isFile(filePath) && !path.extname(pathname)) {
      filePath = path.join(resolvedRoot, "index.html");
      isSpaFallback = true;
    }

    if (!isFile(filePath)) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found\n");
      return;
    }

    const stat = fs.statSync(filePath);
    const servedPath =
      isSpaFallback || filePath === path.join(resolvedRoot, "index.html")
        ? "/index.html"
        : pathname;
    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;

    const headers = {
      ...SECURITY_HEADERS,
      "Content-Type": contentType,
      "Cache-Control": cacheControlFor(servedPath),
      ETag: etag,
      "Last-Modified": stat.mtime.toUTCString(),
      Vary: "Accept-Encoding",
    };

    if (req.headers["if-none-match"] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }

    const acceptsGzip = /\bgzip\b/i.test(req.headers["accept-encoding"] || "");
    const shouldCompress =
      acceptsGzip &&
      stat.size > 1024 &&
      [...COMPRESSIBLE].some((type) => contentType.startsWith(type));

    if (shouldCompress) {
      headers["Content-Encoding"] = "gzip";
    } else {
      headers["Content-Length"] = stat.size;
    }

    res.writeHead(200, headers);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      res.destroy();
    });

    if (shouldCompress) {
      const gzip = createGzip();
      stream.pipe(gzip).pipe(res);
      gzip.on("error", () => res.destroy());
    } else {
      stream.pipe(res);
    }
  };
};
