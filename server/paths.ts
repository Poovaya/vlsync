import path from "node:path";

/**
 * Media ids are opaque to the client: base64url("<rootIndex>:<relPath>").
 * Decoding always re-validates that the resolved file stays inside its root,
 * so a crafted id cannot walk out of the configured folders.
 */

export function encodeMediaId(rootIndex: number, relPath: string): string {
  return Buffer.from(`${rootIndex}:${toPosix(relPath)}`, "utf8").toString("base64url");
}

export interface DecodedId {
  rootIndex: number;
  relPath: string;
}

export function decodeMediaId(id: string): DecodedId | null {
  let raw: string;
  try {
    raw = Buffer.from(id, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const sep = raw.indexOf(":");
  if (sep <= 0) return null;

  const rootIndex = Number.parseInt(raw.slice(0, sep), 10);
  const relPath = raw.slice(sep + 1);
  if (!Number.isInteger(rootIndex) || rootIndex < 0 || relPath.length === 0) return null;

  return { rootIndex, relPath };
}

/**
 * Join a relative path onto its root and refuse anything that escapes it.
 * Returns null rather than throwing so callers map it straight to a 403/404.
 */
export function safeResolve(root: string, relPath: string): string | null {
  if (relPath.includes("\0")) return null;

  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, relPath);

  const rootWithSep = normalizedRoot.endsWith(path.sep)
    ? normalizedRoot
    : normalizedRoot + path.sep;

  const a = process.platform === "win32" ? candidate.toLowerCase() : candidate;
  const b = process.platform === "win32" ? rootWithSep.toLowerCase() : rootWithSep;

  if (!a.startsWith(b)) return null;
  return candidate;
}

export function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}
