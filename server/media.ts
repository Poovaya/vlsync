import path from "node:path";

/** Containers we will list. Not all are decodable by every browser. */
export const VIDEO_EXTENSIONS = new Set([
  "mp4",
  "m4v",
  "webm",
  "ogv",
  "ogg",
  "mov",
  "mkv",
  "avi",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "m2ts",
  "mts",
  "ts",
  "3gp",
  "divx",
]);

/**
 * Containers Chromium/Firefox generally play natively. Everything else is still
 * listed, just flagged so the player can warn up front rather than showing a
 * black screen with no explanation.
 */
const BROWSER_FRIENDLY = new Set(["mp4", "m4v", "webm", "ogv", "ogg", "mov", "mkv"]);

const MIME_BY_EXT: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  flv: "video/x-flv",
  mpg: "video/mpeg",
  mpeg: "video/mpeg",
  m2ts: "video/mp2t",
  mts: "video/mp2t",
  ts: "video/mp2t",
  "3gp": "video/3gpp",
  divx: "video/x-msvideo",
};

export function extensionOf(filename: string): string {
  return path.extname(filename).replace(/^\./, "").toLowerCase();
}

export function isVideoFile(filename: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(filename));
}

export function contentTypeFor(filename: string): string {
  return MIME_BY_EXT[extensionOf(filename)] ?? "application/octet-stream";
}

export function isLikelyPlayable(ext: string): boolean {
  return BROWSER_FRIENDLY.has(ext);
}

/** Junk that shows up in scene releases and adds nothing to a display title. */
const NOISE_TOKENS =
  /\b(?:1080p|2160p|720p|480p|4k|uhd|hdr10?|hdr|sdr|x264|x265|h ?264|h ?265|hevc|avc|aac(?:5 ?1)?|ac3|eac3|dts(?:[- ]hd)?|truehd|atmos|ddp?5 ?1|dd\+?|bluray|blu[- ]ray|brrip|bdrip|webrip|web[- ]dl|webdl|hdtv|dvdrip|remux|proper|repack|extended|unrated|limited|internal|multi|dual|subbed|dubbed|10bit|8bit|hi10p)\b/gi;

const RELEASE_GROUP = /[-.\s](?:rarbg|yts(?:\.\w+)?|yify|evo|fgt|sparks|amiable|geckos|ntb|tbs|cmrg|ion10|galaxyrg|psa|qxr)\b.*$/i;

export interface ParsedTitle {
  title: string;
  subtitle: string | null;
}

/**
 * Turn "The.Show.S02E07.1080p.WEB-DL.x265-GROUP.mkv" into
 * { title: "The Show", subtitle: "S2:E7" } and fall back gracefully for
 * anything that does not look like a scene release.
 */
export function parseTitle(filename: string, relPath: string): ParsedTitle {
  const base = filename.slice(0, filename.length - path.extname(filename).length);

  let working = base.replace(RELEASE_GROUP, "");

  // Season/episode markers: S02E07, 2x07, Season 2 Episode 7.
  let subtitle: string | null = null;
  const se =
    /\bS(\d{1,2})[\s._-]*E(\d{1,3})\b/i.exec(working) ??
    /\b(\d{1,2})x(\d{2,3})\b/.exec(working) ??
    /\bSeason[\s._-]*(\d{1,2})[\s._-]*Episode[\s._-]*(\d{1,3})\b/i.exec(working);

  if (se && se[1] && se[2]) {
    subtitle = `S${Number(se[1])}:E${Number(se[2])}`;
    working = working.slice(0, se.index);
  }

  // Year in parens or standalone often marks the end of a movie title.
  const year = /\b(19\d{2}|20\d{2})\b/.exec(working);
  let yearLabel: string | null = null;
  if (year && year.index > 2) {
    yearLabel = year[1] ?? null;
    working = working.slice(0, year.index);
  }

  working = working
    .replace(NOISE_TOKENS, " ")
    .replace(/[[\](){}]/g, " ")
    .replace(/[._]+/g, " ")
    .replace(/\s*-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  const title = working.length > 0 ? titleCase(working) : base;

  if (!subtitle) {
    if (yearLabel) {
      subtitle = yearLabel;
    } else {
      const dir = path.dirname(relPath);
      subtitle = dir && dir !== "." ? dir.split("/").pop() ?? null : null;
    }
  }

  return { title, subtitle: subtitle === title ? null : subtitle };
}

const LOWERCASE_WORDS = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "the", "to", "vs", "with",
]);

function titleCase(input: string): string {
  const words = input.split(" ");
  return words
    .map((word, i) => {
      if (word.length === 0) return word;
      // Preserve things that are already deliberately cased (e.g. "iPhone", "WALL-E").
      if (/[A-Z]/.test(word.slice(1))) return word;
      const lower = word.toLowerCase();
      if (i > 0 && i < words.length - 1 && LOWERCASE_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}
