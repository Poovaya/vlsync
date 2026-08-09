import path from "node:path";
import fs from "node:fs/promises";
import type { LibraryResponse, MediaItem, MediaRootInfo } from "../shared/types.ts";
import type { ServerConfig } from "./config.ts";
import { extensionOf, isLikelyPlayable, isVideoFile, parseTitle } from "./media.ts";
import { encodeMediaId, toPosix } from "./paths.ts";
import { findSubtitles } from "./subtitles.ts";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  "$recycle.bin",
  "system volume information",
  "@eadir",
  ".trash",
  ".thumbnails",
]);

const CACHE_TTL_MS = 15_000;

let cache: { at: number; value: LibraryResponse } | null = null;

export function invalidateLibraryCache(): void {
  cache = null;
}

export async function getLibrary(config: ServerConfig, force = false): Promise<LibraryResponse> {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }

  const roots: MediaRootInfo[] = [];
  const items: MediaItem[] = [];
  let truncated = false;

  for (const [index, root] of config.roots.entries()) {
    const exists = await isDirectory(root);
    const before = items.length;

    if (exists) {
      const result = await scanRoot(root, index, config, items);
      truncated = truncated || result.truncated;
    }

    roots.push({
      index,
      path: root,
      label: path.basename(root) || root,
      exists,
      fileCount: items.length - before,
    });
  }

  // Newest first: matches how you usually reach for something you just added.
  items.sort((a, b) => b.mtimeMs - a.mtimeMs);

  const value: LibraryResponse = {
    roots,
    items,
    scannedAt: Date.now(),
    truncated,
  };

  cache = { at: Date.now(), value };
  return value;
}

async function scanRoot(
  root: string,
  rootIndex: number,
  config: ServerConfig,
  out: MediaItem[],
): Promise<{ truncated: boolean }> {
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  let truncated = false;

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const { dir, depth } = next;

    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      // Permission denied on a system folder is normal; skip it quietly.
      continue;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;

      const abs = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth >= config.maxDepth) continue;
        if (IGNORED_DIRS.has(entry.name.toLowerCase())) continue;
        queue.push({ dir: abs, depth: depth + 1 });
        continue;
      }

      if (!entry.isFile() || !isVideoFile(entry.name)) continue;

      if (out.length >= config.maxFiles) {
        truncated = true;
        return { truncated };
      }

      const item = await describeFile(root, rootIndex, abs, entry.name);
      if (item) out.push(item);
    }
  }

  return { truncated };
}

async function describeFile(
  root: string,
  rootIndex: number,
  abs: string,
  filename: string,
): Promise<MediaItem | null> {
  let stat: import("node:fs").Stats;
  try {
    stat = await fs.stat(abs);
  } catch {
    return null;
  }

  const relPath = toPosix(path.relative(root, abs));
  const id = encodeMediaId(rootIndex, relPath);
  const ext = extensionOf(filename);
  const { title, subtitle } = parseTitle(filename, relPath);

  return {
    id,
    title,
    subtitle,
    filename,
    relPath,
    rootIndex,
    ext,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    streamUrl: `/api/stream/${id}`,
    subtitles: await findSubtitles(rootIndex, relPath, abs),
    likelyPlayable: isLikelyPlayable(ext),
  };
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
