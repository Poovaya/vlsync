import { clamp, on } from "../util/dom.ts";
import { SyncClient, type SyncStatus } from "./SyncClient.ts";
import type { PlaybackMessage, SyncEvent } from "./protocol.ts";

/** How long after applying a remote change we ignore our own media events. */
const ECHO_SUPPRESS_MS = 600;
/** Scrubbing fires `seeked` continuously; collapse a drag into one message. */
const SEEK_DEBOUNCE_MS = 250;
/** Heartbeat cadence while playing, to catch gradual drift. */
const HEARTBEAT_MS = 10_000;
/** Ignore heartbeat corrections smaller than this; below it, seeking is worse. */
const DRIFT_TOLERANCE_SECONDS = 1;
/** After correcting drift, wait before correcting again so devices don't fight. */
const CORRECTION_COOLDOWN_MS = 3000;
/** Don't bother seeking for a difference this small. */
const SEEK_EPSILON_SECONDS = 0.25;
/** Sanity bound on latency compensation. */
const MAX_LATENCY_SECONDS = 5;
/**
 * Playback rates we will accept from the network. Chrome throws
 * NotSupportedError outside roughly this range, and the topic is an
 * unauthenticated room, so the value is treated as untrusted input.
 */
const MIN_RATE = 0.0625;
const MAX_RATE = 16;
/** Keep a hostile `media` string from being pasted wholesale into a toast. */
const MAX_MEDIA_NAME_CHARS = 80;

export interface PlaybackSyncOptions {
  video: HTMLVideoElement;
  url: string;
  topic: string;
  onStatusChange(status: SyncStatus, detail: string | null): void;
  onNotice(text: string): void;
}

/**
 * Keeps this player in step with other devices on the same MQTT topic.
 *
 * Outbound events come from the media element itself (`play`, `pause`,
 * `seeked`, `ratechange`) rather than from the buttons. Every path that can
 * move the playhead — a click, a keyboard shortcut, a scrub, ±10s, a remote
 * message — ends up setting properties on that element, so listening there
 * catches all of them and cannot drift out of sync with the UI.
 */
export class PlaybackSync {
  private readonly client: SyncClient;
  private readonly video: HTMLVideoElement;
  private readonly disposers: Array<() => void> = [];

  private media: string | null = null;
  private enabled = false;

  private suppressUntil = 0;
  private seekTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private correctionCooldownUntil = 0;
  private warnedAboutMedia = false;

  constructor(private readonly options: PlaybackSyncOptions) {
    this.video = options.video;

    this.client = new SyncClient({
      url: options.url,
      topic: options.topic,
      onMessage: (message) => this.applyRemote(message),
      onStatusChange: (status, detail) => options.onStatusChange(status, detail),
    });

    this.bindMediaEvents();
  }

  get status(): SyncStatus {
    return this.client.currentStatus;
  }

  get deviceId(): string {
    return this.client.id;
  }

  get latencyMs(): number {
    return this.client.oneWayLatencyMs;
  }

  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    this.client.connect();
    this.startHeartbeat();
  }

  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.stopHeartbeat();
    this.client.disconnect();
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Called whenever the player loads a file, so we can refuse mismatched sync. */
  setMedia(filename: string | null): void {
    this.media = filename;
    this.warnedAboutMedia = false;
  }

  dispose(): void {
    this.stopHeartbeat();
    if (this.seekTimer !== null) window.clearTimeout(this.seekTimer);
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.client.disconnect();
  }

  /* ------------------------------------------------------------- outbound */

  private bindMediaEvents(): void {
    this.disposers.push(
      on(this.video, "play", () => this.publish("play")),
      on(this.video, "pause", () => this.publish("pause")),
      on(this.video, "ratechange", () => this.publish("rate")),
      on(this.video, "seeked", () => this.publishSeekDebounced()),
    );
  }

  private publishSeekDebounced(): void {
    if (this.seekTimer !== null) window.clearTimeout(this.seekTimer);
    this.seekTimer = window.setTimeout(() => {
      this.seekTimer = null;
      this.publish("seek");
    }, SEEK_DEBOUNCE_MS);
  }

  private publish(event: SyncEvent): void {
    if (!this.enabled) return;
    // The change we are reacting to is one we just applied from someone else.
    if (Date.now() < this.suppressUntil) return;
    if (!Number.isFinite(this.video.currentTime)) return;

    this.client.publish({
      event,
      position: this.video.currentTime,
      paused: this.video.paused,
      rate: this.video.playbackRate,
      media: this.media,
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (!this.enabled || this.video.paused) return;
      this.publish("sync");
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /* -------------------------------------------------------------- inbound */

  private applyRemote(message: PlaybackMessage): void {
    if (!this.enabled) return;

    if (!this.mediaMatches(message)) {
      if (!this.warnedAboutMedia) {
        this.warnedAboutMedia = true;
        const name = (message.media ?? "").slice(0, MAX_MEDIA_NAME_CHARS);
        this.options.onNotice(`Another device is playing "${name}" — not syncing.`);
      }
      return;
    }

    const target = this.compensate(message);
    const drift = Math.abs(this.video.currentTime - target);

    // Heartbeats are advisory: correcting tiny differences causes visible
    // stutter and can make two devices chase each other indefinitely.
    if (message.event === "sync") {
      if (drift < DRIFT_TOLERANCE_SECONDS) return;
      if (Date.now() < this.correctionCooldownUntil) return;
      this.correctionCooldownUntil = Date.now() + CORRECTION_COOLDOWN_MS;
    }

    this.suppressUntil = Date.now() + ECHO_SUPPRESS_MS;

    // Anything past this point touches the media element with values that came
    // off an open topic. A rejected value must not escape as an unhandled
    // error, or one bad message would take the sync loop down with it.
    try {
      const rate = clamp(message.rate, MIN_RATE, MAX_RATE);
      if (Number.isFinite(rate) && rate !== this.video.playbackRate) {
        this.video.playbackRate = rate;
      }

      if (drift > SEEK_EPSILON_SECONDS) {
        this.video.currentTime = target;
      }

      if (message.paused && !this.video.paused) {
        this.video.pause();
      } else if (!message.paused && this.video.paused) {
        void this.video.play().catch(() => {
          this.options.onNotice("A device started playback — press play to join (autoplay was blocked).");
        });
      }
    } catch (err) {
      this.options.onNotice(
        `Ignored an unusable sync message${err instanceof Error ? `: ${err.message.slice(0, 90)}` : ""}`,
      );
    }
  }

  /**
   * Advance the reported position by however long the message spent in flight,
   * so a device that receives it late still lands in the right place.
   *
   * Latency is the sender's own broker estimate plus ours, both measured as
   * half a round trip. Deliberately not computed from timestamps: two devices'
   * clocks can be seconds apart, which would corrupt every correction.
   */
  private compensate(message: PlaybackMessage): number {
    const latencySeconds = message.paused
      ? 0
      : clamp((message.pingMs + this.client.oneWayLatencyMs) / 1000, 0, MAX_LATENCY_SECONDS);

    const rate = clamp(message.rate, MIN_RATE, MAX_RATE);
    const target = message.position + latencySeconds * rate;

    // Clamp both ends. A negative position is not merely useless — the element
    // stores it and the playhead ends up somewhere it can never play from.
    const duration = this.video.duration;
    const upper = Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
    return clamp(target, 0, upper);
  }

  /** Legacy clients send no media name; there is nothing to check against. */
  private mediaMatches(message: PlaybackMessage): boolean {
    if (!message.media || !this.media) return true;
    return message.media.toLowerCase() === this.media.toLowerCase();
  }
}
