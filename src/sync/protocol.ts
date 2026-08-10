/**
 * Wire format for playback sync, kept compatible with the existing vlsync
 * Python/Electron client (backend/mqtt_client.py).
 *
 * That client publishes:
 *   { sender, action: true|false|null, media_time: <int seconds>, ping: <ms> }
 * where action is play=true, pause=false, seek=null.
 *
 * We publish those exact fields so existing devices keep working, and add
 * higher-precision ones alongside. Unknown keys are ignored by both sides, so
 * the extension costs nothing in compatibility.
 */

export type SyncEvent = "play" | "pause" | "seek" | "rate" | "sync";

export interface PlaybackMessage {
  sender: string;
  event: SyncEvent;
  /** Fractional seconds. Legacy clients only get the truncated `media_time`. */
  position: number;
  paused: boolean;
  rate: number;
  /** Sender's own estimate of its one-way latency to the broker, in ms. */
  pingMs: number;
  /** Basename of the file, so we can refuse to sync against a different video. */
  media: string | null;
}

interface WireMessage {
  sender?: unknown;
  action?: unknown;
  media_time?: unknown;
  ping?: unknown;
  event?: unknown;
  position?: unknown;
  paused?: unknown;
  rate?: unknown;
  media?: unknown;
}

export function encode(message: PlaybackMessage): string {
  const legacyAction = message.event === "play" ? true : message.event === "pause" ? false : null;

  return JSON.stringify({
    // --- fields the existing Python client reads ---
    sender: message.sender,
    action: legacyAction,
    media_time: Math.floor(message.position),
    ping: message.pingMs,

    // --- extensions; older clients ignore these ---
    event: message.event,
    position: Number(message.position.toFixed(3)),
    paused: message.paused,
    rate: message.rate,
    media: message.media,
  });
}

/**
 * Parse an inbound payload. Returns null for anything unrecognisable — the test
 * scripts in vlsync/testfiles publish plain strings to this same topic, so
 * non-JSON traffic is expected rather than exceptional.
 */
export function decode(payload: string): PlaybackMessage | null {
  let raw: WireMessage;
  try {
    const parsed: unknown = JSON.parse(payload);
    if (!parsed || typeof parsed !== "object") return null;
    raw = parsed as WireMessage;
  } catch {
    return null;
  }

  const sender = typeof raw.sender === "string" ? raw.sender : null;
  if (!sender) return null;

  // Prefer the precise field, fall back to the legacy integer seconds.
  const position = firstNumber(raw.position, raw.media_time);
  if (position === null) return null;

  const event = readEvent(raw);

  // `paused` is authoritative when present; otherwise derive it from the legacy
  // tri-state action, and treat a bare seek as "leave play state alone".
  const paused =
    typeof raw.paused === "boolean"
      ? raw.paused
      : raw.action === true
        ? false
        : raw.action === false
          ? true
          : null;

  return {
    sender,
    event,
    position,
    // A legacy seek carries no play state; "not paused" is the safer guess
    // because a paused sender will send an explicit pause too.
    paused: paused ?? false,
    rate: firstNumber(raw.rate) ?? 1,
    pingMs: firstNumber(raw.ping) ?? 0,
    media: typeof raw.media === "string" ? raw.media : null,
  };
}

function readEvent(raw: WireMessage): SyncEvent {
  if (
    raw.event === "play" ||
    raw.event === "pause" ||
    raw.event === "seek" ||
    raw.event === "rate" ||
    raw.event === "sync"
  ) {
    return raw.event;
  }

  if (raw.action === true) return "play";
  if (raw.action === false) return "pause";
  return "seek";
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Identity for the `sender` field, used to tell our own echoes apart from a
 * real remote command.
 *
 * Deliberately per-tab (sessionStorage, not localStorage): two tabs of the same
 * browser are two independent players and should be able to sync to each other.
 * Sharing one id would make each mistake the other's messages for its own echo
 * and ignore them. It still survives a reload, so a refresh keeps its identity.
 */
export function deviceId(): string {
  const KEY = "vsync:device-id";
  const created = `vsync-web-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const existing = sessionStorage.getItem(KEY);
    if (existing) return existing;
    sessionStorage.setItem(KEY, created);
    return created;
  } catch {
    return created;
  }
}
