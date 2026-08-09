export interface ByteRange {
  start: number;
  end: number; // inclusive
}

export type RangeResult =
  | { kind: "none" }
  | { kind: "ok"; range: ByteRange }
  | { kind: "unsatisfiable" };

/**
 * Parse a single-range `Range: bytes=...` header.
 *
 * Multi-range requests are deliberately treated as "none" (serve the whole
 * body, 200) — media elements never send them, and answering with a real
 * multipart/byteranges body would be pure complexity for no gain.
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: "none" };

  const match = /^bytes=(.*)$/i.exec(header.trim());
  if (!match || !match[1]) return { kind: "none" };

  const spec = match[1];
  if (spec.includes(",")) return { kind: "none" };

  const [rawStart = "", rawEnd = ""] = spec.split("-", 2);
  const hasStart = rawStart.trim() !== "";
  const hasEnd = rawEnd.trim() !== "";

  if (!hasStart && !hasEnd) return { kind: "unsatisfiable" };

  // An empty file can satisfy no byte range at all.
  if (size === 0) return { kind: "unsatisfiable" };

  let start: number;
  let end: number;

  if (!hasStart) {
    // Suffix form: "bytes=-500" means the final 500 bytes.
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    if (!Number.isInteger(start) || start < 0) return { kind: "unsatisfiable" };
    if (start >= size) return { kind: "unsatisfiable" };

    if (hasEnd) {
      const parsedEnd = Number(rawEnd);
      if (!Number.isInteger(parsedEnd) || parsedEnd < start) return { kind: "unsatisfiable" };
      end = Math.min(parsedEnd, size - 1);
    } else {
      end = size - 1;
    }
  }

  return { kind: "ok", range: { start, end } };
}
