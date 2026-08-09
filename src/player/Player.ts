import type { PlaybackSource } from "../types.ts";
import { findCompatIssues, type CompatIssue } from "../compat.ts";
import { prefsStore, progressStore, type Prefs } from "../storage.ts";
import { clamp, clear, el, on } from "../util/dom.ts";
import { formatTime } from "../util/format.ts";
import { icons } from "./icons.ts";
import { Scrubber } from "./Scrubber.ts";
import { VolumeControl } from "./VolumeControl.ts";
import { createSpeedMenu, createSubtitlesMenu, PLAYBACK_RATES, type AudioOption } from "./menus.ts";

const IDLE_DELAY_MS = 3000;
const SKIP_SECONDS = 10;
const PROGRESS_SAVE_INTERVAL_MS = 5000;
/** Distinguishes a real single click from the first half of a double click. */
const CLICK_DEBOUNCE_MS = 220;

export interface PlayerCallbacks {
  onExit(): void;
  onNext(): void;
  onPrevious(): void;
}

export interface LoadOptions {
  source: PlaybackSource;
  hasNext: boolean;
  hasPrevious: boolean;
}

interface AudioTrackLike {
  label: string;
  language: string;
  enabled: boolean;
}

interface AudioTrackListLike {
  readonly length: number;
  [index: number]: AudioTrackLike;
}

export class Player {
  readonly root: HTMLElement;

  private readonly video: HTMLVideoElement;
  private readonly scrubber: Scrubber;
  private readonly volume: VolumeControl;
  private readonly speedMenu: ReturnType<typeof createSpeedMenu>;
  private readonly subtitlesMenu: ReturnType<typeof createSubtitlesMenu>;

  private readonly playButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly fullscreenButton: HTMLButtonElement;
  private readonly pipButton: HTMLButtonElement;
  private readonly titleEl: HTMLElement;
  private readonly topTitleEl: HTMLElement;
  private readonly flashEl: HTMLElement;
  private readonly toastEl: HTMLElement;
  private readonly noticeEl: HTMLElement;
  private readonly errorBody: HTMLElement;

  private readonly disposers: Array<() => void> = [];

  private source: PlaybackSource | null = null;
  private prefs: Prefs;

  private idleTimer: number | null = null;
  private toastTimer: number | null = null;
  private clickTimer: number | null = null;
  private lastSavedAt = 0;
  /** Guards against a slow probe landing after the user switched files. */
  private loadToken = 0;
  private menusOpen = 0;
  private scrubbing = false;
  private activeSubtitle: number | null = null;
  private resumeTarget: number | null = null;

  constructor(private readonly callbacks: PlayerCallbacks) {
    this.prefs = prefsStore.load();

    this.video = el("video", {
      class: "player__video",
      // Autoplay is allowed because the user always arrives here by clicking.
      aria: { label: "Video player" },
    });
    this.video.playsInline = true;
    this.video.preload = "auto";

    this.scrubber = new Scrubber({
      onSeek: (time) => this.seekTo(time),
      onScrubStateChange: (scrubbing) => {
        this.scrubbing = scrubbing;
        if (scrubbing) this.wake();
        else this.scheduleIdle();
      },
    });

    this.volume = new VolumeControl({
      onVolumeChange: (value) => this.setVolume(value, false),
      onToggleMute: () => this.toggleMute(),
    });

    this.speedMenu = createSpeedMenu({
      onSelect: (rate) => this.setPlaybackRate(rate),
      onOpenChange: (open) => this.trackMenu(open),
    });

    this.subtitlesMenu = createSubtitlesMenu({
      onSelectSubtitle: (index) => this.setSubtitleTrack(index),
      onSelectAudio: (index) => this.setAudioTrack(index),
      onOpenChange: (open) => this.trackMenu(open),
    });

    this.playButton = el("button", {
      class: "ctl ctl--play",
      type: "button",
      data: { label: "Play" },
      aria: { label: "Play" },
      html: icons.play,
      on: { click: () => this.togglePlay() },
    });

    this.prevButton = el("button", {
      class: "ctl",
      type: "button",
      data: { label: "Previous" },
      aria: { label: "Previous video" },
      html: icons.previous,
      on: { click: () => this.callbacks.onPrevious() },
    });

    this.nextButton = el("button", {
      class: "ctl",
      type: "button",
      data: { label: "Next episode" },
      aria: { label: "Next video" },
      html: icons.next,
      on: { click: () => this.callbacks.onNext() },
    });

    this.fullscreenButton = el("button", {
      class: "ctl",
      type: "button",
      data: { label: "Full screen" },
      aria: { label: "Full screen" },
      html: icons.fullscreenEnter,
      on: { click: () => void this.toggleFullscreen() },
    });

    this.pipButton = el("button", {
      class: "ctl",
      type: "button",
      data: { label: "Miniplayer" },
      aria: { label: "Picture in picture" },
      html: icons.pip,
      on: { click: () => void this.togglePip() },
    });

    this.titleEl = el("div", { class: "controls__title" });
    this.topTitleEl = el("div", { class: "player__toptitle" });
    this.flashEl = el("div", { class: "player__flash" });
    this.toastEl = el("div", { class: "toast", role: "status" });
    this.noticeEl = el("div", { class: "notice", role: "status", data: { visible: "false" } });
    this.errorBody = el("p", {});

    this.root = this.build();

    this.bindVideoEvents();
    this.bindPointerEvents();
    this.bindKeyboard();
    this.bindLifecycle();

    this.applyPrefs();
  }

  /* --------------------------------------------------------------- view -- */

  private build(): HTMLElement {
    const back = el("button", {
      class: "player__back",
      type: "button",
      aria: { label: "Back to library" },
      html: icons.back,
      on: { click: () => this.callbacks.onExit() },
    });

    const top = el("div", { class: "player__top" }, back, this.topTitleEl);

    const controls = el(
      "div",
      { class: "controls" },
      el(
        "div",
        { class: "controls__group controls__group--left" },
        this.playButton,
        el("button", {
          class: "ctl",
          type: "button",
          data: { label: "Back 10 seconds" },
          aria: { label: "Back 10 seconds" },
          html: icons.back10,
          on: { click: () => this.skip(-SKIP_SECONDS) },
        }),
        el("button", {
          class: "ctl",
          type: "button",
          data: { label: "Forward 10 seconds" },
          aria: { label: "Forward 10 seconds" },
          html: icons.forward10,
          on: { click: () => this.skip(SKIP_SECONDS) },
        }),
        this.volume.root,
      ),
      this.titleEl,
      el(
        "div",
        { class: "controls__group controls__group--right" },
        this.speedMenu.popover.root,
        this.subtitlesMenu.popover.root,
        this.prevButton,
        this.nextButton,
        this.pipButton,
        this.fullscreenButton,
      ),
    );

    const bottom = el("div", { class: "player__bottom" }, this.scrubber.root, controls);

    const error = el(
      "div",
      { class: "player__error" },
      el("div", { html: icons.warning, style: { width: "3rem", color: "#e50914" } }),
      el("h2", { text: "This file won't play" }),
      this.errorBody,
      el("button", {
        class: "btn-primary",
        type: "button",
        text: "Back to library",
        on: { click: () => this.callbacks.onExit() },
      }),
    );

    return el(
      "div",
      { class: "player", data: { idle: "false", loading: "false", error: "false" } },
      this.video,
      el("div", { class: "player__scrim player__scrim--top" }),
      el("div", { class: "player__scrim player__scrim--bottom" }),
      el("button", {
        class: "player__tapzone",
        type: "button",
        aria: { label: "Play or pause" },
        on: { click: () => this.handleTapzoneClick() },
      }),
      el("div", { class: "player__spinner" }),
      this.flashEl,
      this.toastEl,
      this.noticeEl,
      top,
      bottom,
      error,
    );
  }

  /* --------------------------------------------------------------- load -- */

  /**
   * Sources are owned by the app, not the player: switching away from one must
   * not revoke its object URL, or stepping back to it would break.
   */
  load({ source, hasNext, hasPrevious }: LoadOptions): void {
    this.saveProgress(true);

    this.source = source;
    this.resumeTarget = progressStore.resumePoint(source.key);
    this.activeSubtitle = null;
    this.hideNotice();

    const token = ++this.loadToken;
    void this.checkCompatibility(source, token);

    this.root.dataset["error"] = "false";
    this.root.dataset["loading"] = "true";

    this.titleEl.textContent = source.title;
    if (source.subtitle) {
      this.titleEl.appendChild(el("span", { text: source.subtitle }));
    }
    this.topTitleEl.textContent = source.subtitle
      ? `${source.title} · ${source.subtitle}`
      : source.title;
    document.title = `${source.title} · vsync`;

    this.prevButton.disabled = !hasPrevious;
    this.nextButton.disabled = !hasNext;

    // Replace <track> children before swapping src so the new cues load with
    // the new media rather than briefly attaching to the old one.
    this.renderSubtitleTracks(source);

    this.video.src = source.src;
    this.video.load();

    this.scrubber.loadSource(source.previewSrc, source.likelyPlayable);
    this.refreshMenus();

    void this.video.play().catch(() => {
      // Autoplay can still be blocked (e.g. a fresh tab with no gesture);
      // the big play button is right there, so this is not an error state.
    });

    if (!source.likelyPlayable) {
      this.showToast(
        `.${source.ext} is not a format browsers decode reliably — if the screen stays black, remux to MP4 (H.264 + AAC).`,
        7000,
      );
    }

    this.wake();
  }

  private renderSubtitleTracks(source: PlaybackSource): void {
    for (const track of Array.from(this.video.querySelectorAll("track"))) {
      track.remove();
    }

    for (const track of source.subtitles) {
      const element = document.createElement("track");
      element.kind = "subtitles";
      element.src = track.url;
      element.srclang = track.lang;
      element.label = track.label;
      this.video.appendChild(element);
    }

    // Text tracks start disabled; the preferred language is applied once
    // metadata lands, by which point textTracks is populated.
    for (let i = 0; i < this.video.textTracks.length; i += 1) {
      const track = this.video.textTracks[i];
      if (track) track.mode = "disabled";
    }
  }

  /* ------------------------------------------------------------- events -- */

  private bindVideoEvents(): void {
    const v = this.video;

    this.disposers.push(
      on(v, "loadedmetadata", () => {
        this.scrubber.setDuration(v.duration);
        this.applyPreferredSubtitle();

        if (this.resumeTarget !== null) {
          const target = this.resumeTarget;
          this.resumeTarget = null;
          if (Number.isFinite(v.duration) && target < v.duration) {
            v.currentTime = target;
            this.showToast(`Resuming from ${formatTime(target)}`);
          }
        }
        this.refreshMenus();
      }),

      on(v, "durationchange", () => this.scrubber.setDuration(v.duration)),

      on(v, "timeupdate", () => {
        this.scrubber.setCurrentTime(v.currentTime);
        this.saveProgress(false);
      }),

      on(v, "progress", () => this.scrubber.setBuffered(v.buffered)),

      on(v, "play", () => this.reflectPlayState()),
      on(v, "pause", () => this.reflectPlayState()),

      on(v, "waiting", () => {
        this.root.dataset["loading"] = "true";
      }),
      on(v, "playing", () => {
        this.root.dataset["loading"] = "false";
        this.root.dataset["error"] = "false";
      }),
      on(v, "canplay", () => {
        this.root.dataset["loading"] = "false";
      }),

      on(v, "ratechange", () => this.speedMenu.setRate(v.playbackRate)),

      on(v, "volumechange", () => {
        this.volume.setState(v.volume, v.muted);
      }),

      on(v, "ended", () => {
        if (this.source) progressStore.clear(this.source.key);
        this.wake();
        if (!this.nextButton.disabled) this.callbacks.onNext();
      }),

      on(v, "error", () => this.showError()),
    );
  }

  private bindPointerEvents(): void {
    this.disposers.push(
      on<HTMLElement, PointerEvent>(this.root, "pointermove", () => this.wake()),
      on<HTMLElement, MouseEvent>(this.root, "dblclick", (ev) => {
        // Cancel the pending single-click toggle so a double click only
        // changes fullscreen instead of also pausing.
        if (this.clickTimer !== null) {
          window.clearTimeout(this.clickTimer);
          this.clickTimer = null;
        }
        ev.preventDefault();
        void this.toggleFullscreen();
      }),
      on(document, "fullscreenchange", () => this.reflectFullscreen()),
    );
  }

  private bindKeyboard(): void {
    this.disposers.push(
      on<Document, KeyboardEvent>(document, "keydown", (ev) => {
        if (!this.isActive()) return;
        if (isTypingTarget(ev.target)) return;
        if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

        const handled = this.handleKey(ev);
        if (handled) {
          ev.preventDefault();
          this.wake();
        }
      }),
    );
  }

  private handleKey(ev: KeyboardEvent): boolean {
    switch (ev.key) {
      case " ":
      case "k":
      case "K":
        this.togglePlay();
        return true;

      case "ArrowRight":
      case "l":
      case "L":
        this.skip(SKIP_SECONDS);
        return true;

      case "ArrowLeft":
      case "j":
      case "J":
        this.skip(-SKIP_SECONDS);
        return true;

      case "ArrowUp":
        this.setVolume(this.video.volume + 0.05, true);
        return true;

      case "ArrowDown":
        this.setVolume(this.video.volume - 0.05, true);
        return true;

      case "m":
      case "M":
        this.toggleMute();
        return true;

      case "f":
      case "F":
        void this.toggleFullscreen();
        return true;

      case "p":
      case "P":
        void this.togglePip();
        return true;

      case "c":
      case "C":
        this.cycleSubtitles();
        return true;

      case "n":
      case "N":
        if (!this.nextButton.disabled) this.callbacks.onNext();
        return true;

      case ",":
        this.stepFrame(-1);
        return true;

      case ".":
        this.stepFrame(1);
        return true;

      case "<":
        this.nudgeRate(-1);
        return true;

      case ">":
        this.nudgeRate(1);
        return true;

      case "Escape":
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
        else this.callbacks.onExit();
        return true;

      default: {
        // Digits jump to that tenth of the runtime, as on YouTube/Netflix.
        if (/^[0-9]$/.test(ev.key) && Number.isFinite(this.video.duration)) {
          this.seekTo((Number(ev.key) / 10) * this.video.duration);
          return true;
        }
        return false;
      }
    }
  }

  private bindLifecycle(): void {
    this.disposers.push(
      on(window, "pagehide", () => this.saveProgress(true)),
      on(document, "visibilitychange", () => {
        if (document.visibilityState === "hidden") this.saveProgress(true);
      }),
    );
  }

  /* ------------------------------------------------------------ actions -- */

  private handleTapzoneClick(): void {
    if (this.clickTimer !== null) window.clearTimeout(this.clickTimer);
    this.clickTimer = window.setTimeout(() => {
      this.clickTimer = null;
      this.togglePlay();
    }, CLICK_DEBOUNCE_MS);
  }

  togglePlay(): void {
    if (this.video.paused || this.video.ended) {
      void this.video.play().catch(() => this.showError());
      this.flash(icons.play);
    } else {
      this.video.pause();
      this.flash(icons.pause);
    }
  }

  private skip(delta: number): void {
    this.seekTo(this.video.currentTime + delta);
    this.flash(delta > 0 ? icons.forward10 : icons.back10);
  }

  private stepFrame(direction: number): void {
    if (!this.video.paused) this.video.pause();
    // No frame-accurate API in HTML media; ~30fps is a good enough nudge.
    this.seekTo(this.video.currentTime + direction / 30);
  }

  private seekTo(time: number): void {
    const duration = this.video.duration;
    const max = Number.isFinite(duration) && duration > 0 ? duration : time;
    const target = clamp(time, 0, max);
    this.video.currentTime = target;
    this.scrubber.setCurrentTime(target);
  }

  private setVolume(value: number, showFeedback: boolean): void {
    const next = clamp(value, 0, 1);
    this.video.volume = next;
    // Any deliberate volume change implies you want to hear it again.
    if (next > 0) this.video.muted = false;

    this.prefs = { ...this.prefs, volume: next, muted: this.video.muted };
    prefsStore.patch({ volume: next, muted: this.video.muted });

    if (showFeedback) this.showToast(`Volume ${Math.round(next * 100)}%`, 900);
  }

  private toggleMute(): void {
    this.video.muted = !this.video.muted;
    this.prefs = { ...this.prefs, muted: this.video.muted };
    prefsStore.patch({ muted: this.video.muted });
  }

  private setPlaybackRate(rate: number): void {
    this.video.playbackRate = rate;
    this.prefs = { ...this.prefs, playbackRate: rate };
    prefsStore.patch({ playbackRate: rate });
    this.speedMenu.setRate(rate);
    this.speedMenu.popover.setOpen(false);
  }

  private nudgeRate(direction: number): void {
    const index = PLAYBACK_RATES.indexOf(this.video.playbackRate as (typeof PLAYBACK_RATES)[number]);
    const from = index === -1 ? PLAYBACK_RATES.indexOf(1) : index;
    const next = PLAYBACK_RATES[clamp(from + direction, 0, PLAYBACK_RATES.length - 1)];
    if (next === undefined) return;
    this.setPlaybackRate(next);
    this.showToast(next === 1 ? "Normal speed" : `Speed ${next}x`, 900);
  }

  private async toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await this.root.requestFullscreen();
    } catch {
      this.showToast("Full screen was blocked by the browser.", 2500);
    }
  }

  private reflectFullscreen(): void {
    const active = document.fullscreenElement !== null;
    this.fullscreenButton.innerHTML = active ? icons.fullscreenExit : icons.fullscreenEnter;
    const label = active ? "Exit full screen" : "Full screen";
    this.fullscreenButton.dataset["label"] = label;
    this.fullscreenButton.setAttribute("aria-label", label);
  }

  private async togglePip(): Promise<void> {
    if (!document.pictureInPictureEnabled) {
      this.showToast("This browser does not support the miniplayer.", 2500);
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await this.video.requestPictureInPicture();
    } catch {
      this.showToast("Miniplayer is unavailable for this video.", 2500);
    }
  }

  /* ---------------------------------------------------------- subtitles -- */

  private applyPreferredSubtitle(): void {
    const preferred = this.prefs.subtitleLang;
    if (!preferred || !this.source) {
      this.setSubtitleTrack(null, false);
      return;
    }

    const index = this.source.subtitles.findIndex((track) => track.lang === preferred);
    this.setSubtitleTrack(index >= 0 ? index : null, false);
  }

  private setSubtitleTrack(index: number | null, persist = true): void {
    const tracks = this.video.textTracks;

    for (let i = 0; i < tracks.length; i += 1) {
      const track = tracks[i];
      if (track) track.mode = i === index ? "showing" : "disabled";
    }

    this.activeSubtitle = index;

    if (persist) {
      const lang = index === null ? null : this.source?.subtitles[index]?.lang ?? null;
      this.prefs = { ...this.prefs, subtitleLang: lang };
      prefsStore.patch({ subtitleLang: lang });
    }

    this.refreshMenus();
    this.subtitlesMenu.popover.setOpen(false);
  }

  private cycleSubtitles(): void {
    const count = this.source?.subtitles.length ?? 0;
    if (count === 0) {
      this.showToast("No subtitle files were found next to this video.", 2200);
      return;
    }

    // Off -> first -> ... -> last -> Off
    const next = this.activeSubtitle === null ? 0 : this.activeSubtitle + 1;
    const target = next >= count ? null : next;
    this.setSubtitleTrack(target);
    this.showToast(
      target === null ? "Subtitles off" : `Subtitles: ${this.source?.subtitles[target]?.label ?? ""}`,
      1400,
    );
  }

  private setAudioTrack(index: number): void {
    const tracks = this.audioTracks();
    if (!tracks) return;

    for (let i = 0; i < tracks.length; i += 1) {
      const track = tracks[i];
      if (track) track.enabled = i === index;
    }
    this.refreshMenus();
    this.subtitlesMenu.popover.setOpen(false);
  }

  private audioTracks(): AudioTrackListLike | null {
    const maybe = (this.video as unknown as { audioTracks?: AudioTrackListLike }).audioTracks;
    return maybe && typeof maybe.length === "number" ? maybe : null;
  }

  private refreshMenus(): void {
    const tracks = this.audioTracks();
    const audio: AudioOption[] = [];
    let activeAudio: number | null = null;

    if (tracks) {
      for (let i = 0; i < tracks.length; i += 1) {
        const track = tracks[i];
        if (!track) continue;
        audio.push({ index: i, label: track.label || track.language || `Track ${i + 1}` });
        if (track.enabled) activeAudio = i;
      }
    }

    this.subtitlesMenu.update({
      subtitles: this.source?.subtitles ?? [],
      activeSubtitle: this.activeSubtitle,
      audio,
      activeAudio,
    });
  }

  /* ------------------------------------------------------------- chrome -- */

  private applyPrefs(): void {
    this.video.volume = this.prefs.volume;
    this.video.muted = this.prefs.muted;
    this.video.playbackRate = this.prefs.playbackRate;
    this.volume.setState(this.prefs.volume, this.prefs.muted);
    this.speedMenu.setRate(this.prefs.playbackRate);
    this.reflectPlayState();
    this.reflectFullscreen();
  }

  private reflectPlayState(): void {
    const paused = this.video.paused;
    this.playButton.innerHTML = paused ? icons.play : icons.pause;
    const label = paused ? "Play" : "Pause";
    this.playButton.dataset["label"] = label;
    this.playButton.setAttribute("aria-label", label);

    if (paused) this.wake();
    else this.scheduleIdle();
  }

  private trackMenu(open: boolean): void {
    this.menusOpen = Math.max(0, this.menusOpen + (open ? 1 : -1));
    if (open) this.wake();
    else this.scheduleIdle();
  }

  /** Controls stay up while paused, while scrubbing, or while a menu is open. */
  private scheduleIdle(): void {
    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    this.idleTimer = null;

    if (this.video.paused || this.scrubbing || this.menusOpen > 0) return;

    this.idleTimer = window.setTimeout(() => {
      this.idleTimer = null;
      this.root.dataset["idle"] = "true";
    }, IDLE_DELAY_MS);
  }

  private wake(): void {
    this.root.dataset["idle"] = "false";
    this.scheduleIdle();
  }

  private flash(icon: string): void {
    this.flashEl.innerHTML = icon;
    this.flashEl.dataset["animate"] = "false";
    // Force a reflow so the animation restarts on repeated presses.
    void this.flashEl.offsetWidth;
    this.flashEl.dataset["animate"] = "true";
  }

  /**
   * Read the container's real codecs and say plainly when the browser cannot
   * decode one of them. Without this, an E-AC-3 track just plays silently and
   * looks like a bug in the player.
   */
  private async checkCompatibility(source: PlaybackSource, token: number): Promise<void> {
    const probe = await source.probe();
    // The user may have moved on while we were reading the file.
    if (token !== this.loadToken || !probe) return;

    const issues = findCompatIssues(probe, this.video, source.filename, source.subtitles.length > 0);
    if (issues.length > 0) this.showNotice(issues);
  }

  private showNotice(issues: CompatIssue[]): void {
    clear(this.noticeEl);

    this.noticeEl.append(
      el("div", { class: "notice__icon", html: icons.warning }),
      el(
        "div",
        { class: "notice__body" },
        ...issues.map((issue) =>
          el(
            "div",
            { class: "notice__item" },
            el("p", { class: "notice__message", text: issue.message }),
            issue.fix ? el("code", { class: "notice__fix", text: issue.fix }) : null,
          ),
        ),
      ),
      el("button", {
        class: "notice__close",
        type: "button",
        text: "✕",
        aria: { label: "Dismiss" },
        on: { click: () => this.hideNotice() },
      }),
    );

    this.noticeEl.dataset["visible"] = "true";
  }

  private hideNotice(): void {
    this.noticeEl.dataset["visible"] = "false";
  }

  private showToast(message: string, duration = 3200): void {
    this.toastEl.textContent = message;
    this.toastEl.dataset["visible"] = "true";

    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => {
      this.toastEl.dataset["visible"] = "false";
      this.toastTimer = null;
    }, duration);
  }

  private showError(): void {
    const error = this.video.error;
    const ext = this.source?.ext ?? "";

    let detail = "The browser could not play this file.";
    if (error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
      detail =
        `The .${ext} container or its codecs are not supported by this browser. ` +
        `MP4 (H.264 + AAC) and WebM always work; MKV plays only when its streams happen to be H.264/AAC.`;
    } else if (error?.code === MediaError.MEDIA_ERR_NETWORK) {
      detail = "The connection to the media server dropped while loading this file.";
    } else if (error?.code === MediaError.MEDIA_ERR_DECODE) {
      detail = "The file decoded partway and then failed — it may be truncated or corrupt.";
    }

    this.errorBody.textContent = detail;
    this.root.dataset["error"] = "true";
    this.root.dataset["loading"] = "false";
  }

  /* ------------------------------------------------------------ storage -- */

  private saveProgress(force: boolean): void {
    if (!this.source) return;

    const now = Date.now();
    if (!force && now - this.lastSavedAt < PROGRESS_SAVE_INTERVAL_MS) return;
    this.lastSavedAt = now;

    progressStore.save(this.source.key, this.video.currentTime, this.video.duration);
  }

  private isActive(): boolean {
    return this.root.isConnected;
  }

  /* ------------------------------------------------------------ teardown - */

  dispose(): void {
    this.saveProgress(true);

    if (this.idleTimer !== null) window.clearTimeout(this.idleTimer);
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    if (this.clickTimer !== null) window.clearTimeout(this.clickTimer);

    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;

    this.scrubber.dispose();
    this.volume.dispose();
    this.speedMenu.popover.dispose();
    this.subtitlesMenu.popover.dispose();

    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();

    this.source = null;

    document.title = "vsync";
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable
  );
}
