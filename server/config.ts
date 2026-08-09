import path from "node:path";
import fs from "node:fs";
import os from "node:os";

export interface ServerConfig {
  port: number;
  host: string;
  roots: string[];
  maxFiles: number;
  maxDepth: number;
}

const CONFIG_FILE = "vsync.config.json";

interface FileConfig {
  port?: number;
  host?: string;
  roots?: string[];
  maxFiles?: number;
  maxDepth?: number;
}

function readConfigFile(cwd: string): FileConfig {
  const file = path.join(cwd, CONFIG_FILE);
  if (!fs.existsSync(file)) return {};
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object") return parsed as FileConfig;
  } catch (err) {
    console.warn(`[config] Ignoring malformed ${CONFIG_FILE}: ${String(err)}`);
  }
  return {};
}

/**
 * Media roots come from (highest priority first):
 *   1. CLI args        node server/index.ts "D:/Movies" "E:/Shows"
 *   2. MEDIA_DIRS env  MEDIA_DIRS="D:/Movies;E:/Shows"
 *   3. vsync.config.json  { "roots": ["D:/Movies"] }
 *   4. ./media next to the project
 *
 * Multiple roots are supported because media is rarely on one drive. Paths are
 * split on ';' (and ',' when unambiguous) so Windows drive letters survive.
 */
function resolveRoots(cwd: string, argv: string[], fileConfig: FileConfig): string[] {
  const fromArgs = argv.filter((a) => !a.startsWith("-"));
  if (fromArgs.length > 0) return fromArgs.map((p) => path.resolve(cwd, expandHome(p)));

  const env = process.env["MEDIA_DIRS"] ?? process.env["MEDIA_DIR"];
  if (env && env.trim()) {
    return splitPathList(env).map((p) => path.resolve(cwd, expandHome(p)));
  }

  if (fileConfig.roots && fileConfig.roots.length > 0) {
    return fileConfig.roots.map((p) => path.resolve(cwd, expandHome(p)));
  }

  return [path.resolve(cwd, "media")];
}

function splitPathList(value: string): string[] {
  // Prefer ';' so "D:/a,b" style folder names survive. Fall back to ',' only
  // when there is no ';' and no bare drive-letter ambiguity.
  const parts = value.includes(";") ? value.split(";") : value.split(",");
  return parts.map((p) => p.trim()).filter(Boolean);
}

function expandHome(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function intFrom(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(cwd: string = process.cwd()): ServerConfig {
  const argv = process.argv.slice(2);
  const fileConfig = readConfigFile(cwd);

  return {
    port: intFrom(process.env["PORT"], fileConfig.port ?? 8787),
    host: process.env["HOST"] ?? fileConfig.host ?? "127.0.0.1",
    roots: dedupe(resolveRoots(cwd, argv, fileConfig)),
    maxFiles: intFrom(process.env["MAX_FILES"], fileConfig.maxFiles ?? 5000),
    maxDepth: intFrom(process.env["MAX_DEPTH"], fileConfig.maxDepth ?? 8),
  };
}

function dedupe(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = process.platform === "win32" ? p.toLowerCase() : p;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}
