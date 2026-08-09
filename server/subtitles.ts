import path from "node:path";
import fs from "node:fs/promises";
import type { SubtitleTrack } from "../shared/types.ts";
import { encodeMediaId } from "./paths.ts";
import { toPosix } from "./paths.ts";

export const SUBTITLE_EXTENSIONS = new Set(["vtt", "srt"]);

const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  eng: "English",
  es: "Spanish",
  spa: "Spanish",
  fr: "French",
  fre: "French",
  de: "German",
  ger: "German",
  it: "Italian",
  pt: "Portuguese",
  br: "Portuguese (Brazil)",
  ru: "Russian",
  ja: "Japanese",
  jpn: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  chi: "Chinese",
  hi: "Hindi",
  ta: "Tamil",
  te: "Telugu",
  kn: "Kannada",
  ml: "Malayalam",
  ar: "Arabic",
  nl: "Dutch",
  sv: "Swedish",
  no: "Norwegian",
  da: "Danish",
  fi: "Finnish",
  pl: "Polish",
  tr: "Turkish",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
};

/**
 * Find sidecar subtitles that belong to a video: same directory, same basename,
 * optionally suffixed with a language and/or "forced"/"sdh" tag.
 *   Movie.mkv -> Movie.srt, Movie.en.srt, Movie.en.forced.vtt
 */
export async function findSubtitles(
  rootIndex: number,
  videoRelPath: string,
  videoAbsPath: string,
): Promise<SubtitleTrack[]> {
  const dir = path.dirname(videoAbsPath);
  const videoBase = path.basename(videoAbsPath, path.extname(videoAbsPath));

  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const tracks: SubtitleTrack[] = [];

  for (const entry of entries) {
    const ext = path.extname(entry).replace(/^\./, "").toLowerCase();
    if (!SUBTITLE_EXTENSIONS.has(ext)) continue;

    const entryBase = path.basename(entry, path.extname(entry));
    if (entryBase.toLowerCase() !== videoBase.toLowerCase() &&
        !entryBase.toLowerCase().startsWith(videoBase.toLowerCase() + ".")) {
      continue;
    }

    const suffix = entryBase.slice(videoBase.length).replace(/^\./, "");
    const { lang, label } = describeSuffix(suffix);

    const relPath = toPosix(path.join(path.dirname(videoRelPath), entry));
    const id = encodeMediaId(rootIndex, relPath);

    tracks.push({
      id,
      lang,
      label,
      url: `/api/subtitle/${id}`,
      converted: ext === "srt",
    });
  }

  tracks.sort((a, b) => a.label.localeCompare(b.label));
  return tracks;
}

function describeSuffix(suffix: string): { lang: string; label: string } {
  if (!suffix) return { lang: "und", label: "Subtitles" };

  const parts = suffix.split(".").filter(Boolean);
  const flags: string[] = [];
  let lang = "und";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "forced") flags.push("Forced");
    else if (lower === "sdh" || lower === "cc") flags.push("CC");
    else if (lang === "und") lang = lower;
  }

  const base = LANGUAGE_NAMES[lang] ?? (lang === "und" ? "Subtitles" : lang.toUpperCase());
  const label = flags.length > 0 ? `${base} (${flags.join(", ")})` : base;
  return { lang: lang === "und" ? "und" : lang, label };
}

/**
 * Convert SubRip to WebVTT. Browsers only accept VTT in <track>, and the two
 * formats differ mainly in the header and the decimal separator.
 */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^﻿/, "")
    .replace(/\r\n|\r/g, "\n")
    // 00:00:01,500 --> 00:00:04,000
    .replace(
      /(\d{1,2}:\d{2}:\d{2}),(\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g,
      (_m, a: string, ms1: string, b: string, ms2: string) =>
        `${pad2(a)}.${ms1.padEnd(3, "0")} --> ${pad2(b)}.${ms2.padEnd(3, "0")}`,
    )
    // Drop the numeric cue counters; VTT does not need them and stray numbers
    // on their own line can be misread as cue identifiers.
    .replace(/^\d+\n(?=\d{2}:)/gm, "");

  return `WEBVTT\n\n${body.trim()}\n`;
}

/** VTT requires HH:MM:SS.mmm; SRT sometimes emits H:MM:SS. */
function pad2(timestamp: string): string {
  const parts = timestamp.split(":");
  if (parts.length === 3 && parts[0] && parts[0].length === 1) {
    return `0${timestamp}`;
  }
  return timestamp;
}
