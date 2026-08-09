/**
 * Netflix-style hover thumbnails, generated on the fly.
 *
 * A second, hidden <video> shares the same source and is seeked to whatever
 * time the pointer is over; each successful seek is painted into a small
 * canvas. There is no sprite sheet to precompute, which is the whole point for
 * arbitrary files on a local drive.
 *
 * Only one seek is ever in flight — extra requests collapse onto the latest
 * one, so dragging across the bar never queues up hundreds of seeks.
 */

const FRAME_WIDTH = 320;
/** Ignore requests closer than this to what we already drew. */
const MIN_DELTA_SECONDS = 0.4;

export class ThumbnailPreview {
  private readonly video: HTMLVideoElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  private metadataReady = false;
  private failed = false;
  private seeking = false;
  private pendingTime: number | null = null;
  private lastDrawnTime = Number.NaN;
  private disposed = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: false });

    this.video = document.createElement("video");
    // "metadata", not "auto": this element only ever renders single frames on
    // demand, so eagerly buffering the whole file would just fight the player
    // for disk and network.
    this.video.preload = "metadata";
    this.video.muted = true;
    this.video.playsInline = true;
    // Never attached to the DOM; it exists purely as a decode surface.
    this.video.style.display = "none";

    this.video.addEventListener("loadedmetadata", this.handleMetadata);
    this.video.addEventListener("seeked", this.handleSeeked);
    this.video.addEventListener("error", this.handleError);
  }

  get available(): boolean {
    return this.metadataReady && !this.failed && this.ctx !== null;
  }

  load(src: string): void {
    this.metadataReady = false;
    this.failed = false;
    this.seeking = false;
    this.pendingTime = null;
    this.lastDrawnTime = Number.NaN;
    this.canvas.dataset["ready"] = "false";
    this.video.src = src;
    this.video.load();
  }

  /** Ask for the frame at `time`; drawing happens asynchronously. */
  request(time: number): void {
    if (this.disposed || this.failed || !this.metadataReady) return;
    if (!Number.isFinite(time)) return;

    const clamped = Math.max(0, Math.min(time, Math.max(0, this.video.duration - 0.1)));

    if (Math.abs(clamped - this.lastDrawnTime) < MIN_DELTA_SECONDS) return;

    if (this.seeking) {
      this.pendingTime = clamped;
      return;
    }

    this.seeking = true;
    this.video.currentTime = clamped;
  }

  dispose(): void {
    this.disposed = true;
    this.video.removeEventListener("loadedmetadata", this.handleMetadata);
    this.video.removeEventListener("seeked", this.handleSeeked);
    this.video.removeEventListener("error", this.handleError);
    this.video.removeAttribute("src");
    this.video.load();
  }

  private readonly handleMetadata = (): void => {
    this.metadataReady = true;
    const { videoWidth, videoHeight } = this.video;
    if (videoWidth > 0 && videoHeight > 0) {
      this.canvas.width = FRAME_WIDTH;
      this.canvas.height = Math.round((FRAME_WIDTH * videoHeight) / videoWidth);
    }
  };

  private readonly handleSeeked = (): void => {
    if (this.disposed) return;

    this.draw();
    this.seeking = false;

    const next = this.pendingTime;
    this.pendingTime = null;
    if (next !== null) this.request(next);
  };

  private readonly handleError = (): void => {
    // Codec the browser cannot decode, or a source that went away. Give up
    // quietly; the scrub tooltip still shows the timestamp.
    this.failed = true;
    this.seeking = false;
    this.pendingTime = null;
    this.canvas.dataset["ready"] = "false";
  };

  private draw(): void {
    if (!this.ctx || this.video.videoWidth === 0) return;
    try {
      this.ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      this.lastDrawnTime = this.video.currentTime;
      this.canvas.dataset["ready"] = "true";
    } catch {
      // drawImage throws if the frame is not decodable yet; skip this one.
      this.failed = true;
    }
  }
}
