/**
 * Persistence for resume positions and player preferences.
 *
 * localStorage can throw (private mode, disabled storage, quota), so every
 * access is guarded — losing a resume point must never break playback.
 */

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object") return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Storage full or unavailable; preferences are not worth failing over. */
  }
}

/* ------------------------------------------------------------- progress -- */

const PROGRESS_KEY = "vsync:progress:v1";
const MAX_ENTRIES = 300;

/** Below this we assume you barely started; above the tail we call it watched. */
const MIN_RESUME_SECONDS = 15;
const END_THRESHOLD_SECONDS = 45;

interface ProgressEntry {
  time: number;
  duration: number;
  updatedAt: number;
}

type ProgressMap = Record<string, ProgressEntry>;

export const progressStore = {
  get(key: string): ProgressEntry | null {
    const map = readJson<ProgressMap>(PROGRESS_KEY, {});
    return map[key] ?? null;
  },

  /** Returns the position to resume from, or null when it should start over. */
  resumePoint(key: string): number | null {
    const entry = this.get(key);
    if (!entry) return null;
    if (entry.time < MIN_RESUME_SECONDS) return null;
    if (entry.duration > 0 && entry.time > entry.duration - END_THRESHOLD_SECONDS) return null;
    return entry.time;
  },

  save(key: string, time: number, duration: number): void {
    if (!Number.isFinite(time) || time < 0) return;

    const map = readJson<ProgressMap>(PROGRESS_KEY, {});

    const finished =
      Number.isFinite(duration) && duration > 0 && time > duration - END_THRESHOLD_SECONDS;

    if (time < MIN_RESUME_SECONDS || finished) {
      // Nothing worth resuming: drop any stale entry so the badge disappears.
      if (!(key in map)) return;
      delete map[key];
      writeJson(PROGRESS_KEY, map);
      return;
    }

    map[key] = { time, duration, updatedAt: Date.now() };
    writeJson(PROGRESS_KEY, prune(map));
  },

  clear(key: string): void {
    const map = readJson<ProgressMap>(PROGRESS_KEY, {});
    if (!(key in map)) return;
    delete map[key];
    writeJson(PROGRESS_KEY, map);
  },
};

function prune(map: ProgressMap): ProgressMap {
  const entries = Object.entries(map);
  if (entries.length <= MAX_ENTRIES) return map;

  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  return Object.fromEntries(entries.slice(0, MAX_ENTRIES));
}

/* ---------------------------------------------------------- preferences -- */

const PREFS_KEY = "vsync:prefs:v1";

export interface Prefs {
  volume: number;
  muted: boolean;
  playbackRate: number;
  /** Language of the last subtitle track turned on, or null for "Off". */
  subtitleLang: string | null;
}

const DEFAULT_PREFS: Prefs = {
  volume: 1,
  muted: false,
  playbackRate: 1,
  subtitleLang: null,
};

export const prefsStore = {
  load(): Prefs {
    const stored = readJson<Partial<Prefs>>(PREFS_KEY, {});
    return {
      volume: clamp01(numberOr(stored.volume, DEFAULT_PREFS.volume)),
      muted: typeof stored.muted === "boolean" ? stored.muted : DEFAULT_PREFS.muted,
      playbackRate: clampRate(numberOr(stored.playbackRate, DEFAULT_PREFS.playbackRate)),
      subtitleLang: typeof stored.subtitleLang === "string" ? stored.subtitleLang : null,
    };
  },

  patch(update: Partial<Prefs>): void {
    writeJson(PREFS_KEY, { ...this.load(), ...update });
  },
};

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampRate(value: number): number {
  return value < 0.25 ? 0.25 : value > 4 ? 4 : value;
}
