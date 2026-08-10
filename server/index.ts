import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApiError } from "../shared/types.ts";
import { loadConfig, type ServerConfig } from "./config.ts";
import { getLibrary, invalidateLibraryCache } from "./library.ts";
import { contentTypeFor } from "./media.ts";
import { decodeMediaId, safeResolve } from "./paths.ts";
import { probeFile } from "./probe.ts";
import { parseRange } from "./range.ts";
import { srtToVtt } from "./subtitles.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const distDir = path.join(projectRoot, "dist");

const config = loadConfig(projectRoot);

const server = http.createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    console.error("[server] Unhandled error:", err);
    if (!res.headersSent) sendJson(res, 500, { error: "internal_error" });
    else res.destroy();
  });
});

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    sendJson(res, 405, { error: "method_not_allowed" });
    return;
  }

  if (pathname === "/api/health") {
    sendJson(res, 200, { ok: true, roots: config.roots });
    return;
  }

  if (pathname === "/api/library") {
    const force = url.searchParams.get("refresh") === "1";
    if (force) invalidateLibraryCache();
    const library = await getLibrary(config, force);
    sendJson(res, 200, library);
    return;
  }

  if (pathname.startsWith("/api/stream/")) {
    await serveStream(req, res, pathname.slice("/api/stream/".length));
    return;
  }

  if (pathname.startsWith("/api/subtitle/")) {
    await serveSubtitle(req, res, pathname.slice("/api/subtitle/".length));
    return;
  }

  if (pathname.startsWith("/api/probe/")) {
    await serveProbe(res, pathname.slice("/api/probe/".length));
    return;
  }

  if (pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  await serveStatic(req, res, pathname);
}

/** Resolve a client-supplied media id to an absolute path inside a media root. */
function resolveId(id: string, cfg: ServerConfig): string | null {
  const decoded = decodeMediaId(id);
  if (!decoded) return null;

  const root = cfg.roots[decoded.rootIndex];
  if (!root) return null;

  return safeResolve(root, decoded.relPath);
}

async function serveStream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
): Promise<void> {
  const abs = resolveId(id, config);
  if (!abs) {
    sendJson(res, 400, { error: "bad_id" });
    return;
  }

  let stat: fs.Stats;
  try {
    stat = await fsp.stat(abs);
  } catch {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  if (!stat.isFile()) {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  const size = stat.size;
  const etag = weakEtag(stat);

  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", contentTypeFor(abs));
  res.setHeader("Last-Modified", stat.mtime.toUTCString());
  res.setHeader("ETag", etag);
  // Deliberately uncacheable. Chrome routes media range requests through its
  // HTTP cache, and a *cacheable* multi-gigabyte entry exceeds the per-entry
  // limit — the media element then stalls at readyState 0 with no bytes and no
  // error, while plain fetch() of the same URL succeeds. The data is on local
  // disk anyway, so re-reading costs nothing.
  res.setHeader("Cache-Control", "no-store");

  const parsed = parseRange(req.headers.range, size);

  if (parsed.kind === "unsatisfiable") {
    res.setHeader("Content-Range", `bytes */${size}`);
    sendJson(res, 416, { error: "range_not_satisfiable" });
    return;
  }

  const start = parsed.kind === "ok" ? parsed.range.start : 0;
  const end = parsed.kind === "ok" ? parsed.range.end : Math.max(0, size - 1);
  const length = size === 0 ? 0 : end - start + 1;

  if (parsed.kind === "ok") {
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
  } else {
    res.statusCode = 200;
  }
  res.setHeader("Content-Length", String(length));

  if (req.method === "HEAD" || length === 0) {
    res.end();
    return;
  }

  const stream = fs.createReadStream(abs, { start, end });

  // Seeking mid-download aborts the previous request; that surfaces here as an
  // ECONNRESET/EPIPE and is expected, not an error worth logging.
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code !== "ECONNRESET" && err.code !== "EPIPE") {
      console.error(`[stream] ${path.basename(abs)}: ${err.message}`);
    }
    res.destroy();
  });

  res.on("close", () => {
    stream.destroy();
  });

  stream.pipe(res);
}

async function serveSubtitle(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  id: string,
): Promise<void> {
  const abs = resolveId(id, config);
  if (!abs) {
    sendJson(res, 400, { error: "bad_id" });
    return;
  }

  const ext = path.extname(abs).toLowerCase();
  if (ext !== ".vtt" && ext !== ".srt") {
    sendJson(res, 415, { error: "unsupported_subtitle" });
    return;
  }

  let raw: string;
  try {
    raw = await fsp.readFile(abs, "utf8");
  } catch {
    sendJson(res, 404, { error: "not_found" });
    return;
  }

  const vtt = ext === ".srt" ? srtToVtt(raw) : ensureVttHeader(raw);
  const body = Buffer.from(vtt, "utf8");

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/vtt; charset=utf-8");
  res.setHeader("Content-Length", String(body.byteLength));
  res.setHeader("Cache-Control", "private, max-age=3600");
  if (req.method === "HEAD") res.end();
  else res.end(body);
}

/**
 * Reports the codecs actually inside a file so the player can explain a silent
 * or black playback instead of leaving you guessing. MP4/MOV only — other
 * containers return 204 and the UI falls back to its extension heuristic.
 */
async function serveProbe(res: http.ServerResponse, id: string): Promise<void> {
  const abs = resolveId(id, config);
  if (!abs) {
    sendJson(res, 400, { error: "bad_id" });
    return;
  }

  const ext = path.extname(abs).toLowerCase();
  if (ext !== ".mp4" && ext !== ".m4v" && ext !== ".mov") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const result = await probeFile(abs);
  if (!result) {
    res.statusCode = 204;
    res.end();
    return;
  }

  sendJson(res, 200, result);
}

function ensureVttHeader(text: string): string {
  const stripped = text.replace(/^\uFEFF/, "");
  return stripped.trimStart().startsWith("WEBVTT") ? stripped : `WEBVTT\n\n${stripped}`;
}

const STATIC_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

/**
 * Serve the built frontend in production. During development Vite serves the
 * app and proxies /api here, so this path is only hit after `npm run build`.
 */
async function serveStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
): Promise<void> {
  if (!fs.existsSync(distDir)) {
    sendJson(res, 404, {
      error: "frontend_not_built",
      detail: "Run `npm run dev` for the dev server, or `npm run build` to serve from here.",
    });
    return;
  }

  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let target = safeResolve(distDir, rel);

  if (!target || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    // Single-page app: unknown paths fall back to the shell.
    target = path.join(distDir, "index.html");
    if (!fs.existsSync(target)) {
      sendJson(res, 404, { error: "not_found" });
      return;
    }
  }

  const body = await fsp.readFile(target);
  res.statusCode = 200;
  res.setHeader("Content-Type", STATIC_TYPES[path.extname(target).toLowerCase()] ?? "application/octet-stream");
  res.setHeader("Content-Length", String(body.byteLength));

  // Asset filenames carry a content hash, so they can be cached hard. The HTML
  // must not be: a stale index.html keeps pointing at the previous bundle, so a
  // rebuild appears to change nothing.
  const isHashedAsset = target.includes(`${path.sep}assets${path.sep}`);
  res.setHeader("Cache-Control", isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache");
  if (req.method === "HEAD") res.end();
  else res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, payload: ApiError | object): void {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(body.byteLength));
  res.end(body);
}

function weakEtag(stat: fs.Stats): string {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

server.listen(config.port, config.host, () => {
  const where = `http://${config.host}:${config.port}`;
  console.log(`\n  vsync media server  ${where}\n`);
  console.log("  Media roots:");
  for (const root of config.roots) {
    const ok = fs.existsSync(root);
    console.log(`    ${ok ? "*" : "!"} ${root}${ok ? "" : "  (not found)"}`);
  }
  console.log(
    "\n  Point it somewhere else with:  npm run dev:server -- \"D:/Movies\" \"E:/Shows\"\n" +
      "  or set MEDIA_DIRS, or create vsync.config.json\n",
  );
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] Port ${config.port} is already in use. Set PORT to pick another.`);
    process.exit(1);
  }
  throw err;
});
