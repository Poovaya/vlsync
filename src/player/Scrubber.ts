import { clamp, el, on, ratioFromPointer } from "../util/dom.ts";
import { formatTime } from "../util/format.ts";
import { ThumbnailPreview } from "./ThumbnailPreview.ts";

export interface ScrubberCallbacks {
  /** Live seek while dragging, and the final commit on release. */
  onSeek(time: number): void;
  onScrubStateChange(scrubbing: boolean): void;
}

/**
 * The timeline: buffered ranges, red progress fill, draggable handle, and a
 * hover card with a generated thumbnail.
 */
export class Scrubber {
  readonly root: HTMLElement;

  private readonly bar: HTMLElement;
  private readonly buffered: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly handle: HTMLElement;
  private readonly remaining: HTMLElement;
  private readonly preview: HTMLElement;
  private readonly previewCanvas: HTMLCanvasElement;
  private readonly previewTime: HTMLElement;
  private readonly thumbnails: ThumbnailPreview;

  private readonly disposers: Array<() => void> = [];

  private duration = 0;
  private currentTime = 0;
  private scrubbing = false;
  /** While dragging, the UI follows the pointer instead of the media clock. */
  private scrubTime = 0;

  constructor(private readonly callbacks: ScrubberCallbacks) {
    this.buffered = el("div", { class: "scrubber__buffered" });
    this.progress = el("div", { class: "scrubber__progress" });
    this.handle = el("div", { class: "scrubber__handle" });

    this.previewCanvas = el("canvas", { class: "preview__frame" });
    this.previewTime = el("div", { class: "preview__time", text: "0:00" });
    this.preview = el(
      "div",
      { class: "preview", data: { hasFrame: "false" } },
      this.previewCanvas,
      this.previewTime,
    );

    this.bar = el(
      "div",
      {
        class: "scrubber__bar",
        role: "slider",
        tabIndex: 0,
        aria: {
          label: "Seek",
          valuemin: "0",
          valuemax: "0",
          valuenow: "0",
          valuetext: "0:00",
        },
      },
      el("div", { class: "scrubber__track" }, this.buffered, this.progress),
      this.handle,
      this.preview,
    );

    this.remaining = el("div", { class: "scrubber__time", text: "0:00" });

    this.root = el("div", { class: "scrubber", data: { scrubbing: "false" } }, this.bar, this.remaining);

    this.thumbnails = new ThumbnailPreview(this.previewCanvas);
    this.bindPointer();
    this.bindKeyboard();
  }

  loadSource(src: string, enableThumbnails: boolean): void {
    this.duration = 0;
    this.currentTime = 0;
    this.render();
    if (enableThumbnails) this.thumbnails.load(src);
  }

  setDuration(duration: number): void {
    this.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    this.bar.setAttribute("aria-valuemax", this.duration.toFixed(0));
    this.render();
  }

  setCurrentTime(time: number): void {
    this.currentTime = time;
    if (!this.scrubbing) this.render();
  }

  setBuffered(ranges: TimeRanges): void {
    if (this.duration <= 0) return;

    // Show the buffered run that contains the playhead — that is the one that
    // determines whether playback will stall.
    const reference = this.scrubbing ? this.scrubTime : this.currentTime;
    let end = 0;
    for (let i = 0; i < ranges.length; i += 1) {
      const start = ranges.start(i);
      const rangeEnd = ranges.end(i);
      if (start <= reference + 0.5 && rangeEnd >= end) end = rangeEnd;
    }

    this.buffered.style.transform = `scaleX(${clamp(end / this.duration, 0, 1)})`;
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.thumbnails.dispose();
  }

  /* ------------------------------------------------------------ pointer -- */

  private bindPointer(): void {
    this.disposers.push(
      on<HTMLElement, PointerEvent>(this.bar, "pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        this.bar.setPointerCapture(ev.pointerId);
        this.setScrubbing(true);
        this.updateFromPointer(ev.clientX, true);
      }),

      on<HTMLElement, PointerEvent>(this.bar, "pointermove", (ev) => {
        if (this.scrubbing) {
          this.updateFromPointer(ev.clientX, true);
        } else {
          this.updateHover(ev.clientX);
        }
      }),

      on<HTMLElement, PointerEvent>(this.bar, "pointerup", (ev) => {
        if (!this.scrubbing) return;
        this.bar.releasePointerCapture(ev.pointerId);
        this.updateFromPointer(ev.clientX, true);
        this.setScrubbing(false);
      }),

      on<HTMLElement, PointerEvent>(this.bar, "pointercancel", () => {
        if (this.scrubbing) this.setScrubbing(false);
      }),

      on<HTMLElement, PointerEvent>(this.bar, "pointerenter", (ev) => {
        this.updateHover(ev.clientX);
      }),
    );
  }

  private bindKeyboard(): void {
    this.disposers.push(
      on<HTMLElement, KeyboardEvent>(this.bar, "keydown", (ev) => {
        if (this.duration <= 0) return;

        const step = ev.shiftKey ? 30 : 5;
        let target: number | null = null;

        if (ev.key === "ArrowRight") target = this.currentTime + step;
        else if (ev.key === "ArrowLeft") target = this.currentTime - step;
        else if (ev.key === "Home") target = 0;
        else if (ev.key === "End") target = this.duration;

        if (target === null) return;
        ev.preventDefault();
        // Stop the global handler from applying its own seek on top of ours.
        ev.stopPropagation();
        this.callbacks.onSeek(clamp(target, 0, this.duration));
      }),
    );
  }

  private setScrubbing(active: boolean): void {
    this.scrubbing = active;
    this.root.dataset["scrubbing"] = String(active);
    this.callbacks.onScrubStateChange(active);
  }

  private updateFromPointer(clientX: number, seek: boolean): void {
    if (this.duration <= 0) return;

    const ratio = ratioFromPointer(this.bar, clientX);
    this.scrubTime = ratio * this.duration;
    this.currentTime = this.scrubTime;

    this.positionPreview(ratio, this.scrubTime);
    this.render();

    if (seek) this.callbacks.onSeek(this.scrubTime);
  }

  private updateHover(clientX: number): void {
    if (this.duration <= 0) return;
    const ratio = ratioFromPointer(this.bar, clientX);
    this.positionPreview(ratio, ratio * this.duration);
  }

  private positionPreview(ratio: number, time: number): void {
    const rect = this.bar.getBoundingClientRect();

    // Keep the card fully on screen when hovering near either end.
    const half = this.preview.offsetWidth / 2 || 120;
    const raw = ratio * rect.width;
    const left = clamp(raw, half - rect.left, window.innerWidth - rect.left - half);

    this.preview.style.left = `${left}px`;
    this.previewTime.textContent = formatTime(time);

    this.thumbnails.request(time);
    this.preview.dataset["hasFrame"] = this.previewCanvas.dataset["ready"] === "true" ? "true" : "false";
  }

  private render(): void {
    const ratio = this.duration > 0 ? clamp(this.currentTime / this.duration, 0, 1) : 0;

    this.progress.style.transform = `scaleX(${ratio})`;
    this.handle.style.left = `${ratio * 100}%`;

    const remaining = Math.max(0, this.duration - this.currentTime);
    this.remaining.textContent = formatTime(remaining);

    this.bar.setAttribute("aria-valuenow", this.currentTime.toFixed(0));
    this.bar.setAttribute("aria-valuetext", `${formatTime(this.currentTime)} of ${formatTime(this.duration)}`);
  }
}
