import type { MediaItem, ProbeResult, SubtitleTrack } from "../shared/types.ts";
import { fetchProbe, probeLocalFile } from "./probe.ts";

/**
 * Everything the player needs to show one video, regardless of whether it came
 * from the media server or from a file the user dropped onto the page.
 */
export interface PlaybackSource {
  /** Stable identity used to store resume positions. */
  key: string;
  title: string;
  subtitle: string | null;
  filename: string;
  /** URL for the <video> element: an /api/stream URL or a blob: URL. */
  src: string;
  /**
   * A *different* URL for the same bytes, used by the scrub-preview video.
   *
   * Two media elements pointed at one URL share Chrome's media buffer for that
   * resource, and the preview's constant seeking can stall the main element on
   * a cold load. Distinct URLs give each element its own buffer.
   */
  previewSrc: string;
  subtitles: SubtitleTrack[];
  likelyPlayable: boolean;
  ext: string;
  /**
   * Read the real codecs out of the container, so the player can explain a
   * silent or black playback. Resolves null when the format is not probeable.
   */
  probe(): Promise<ProbeResult | null>;
  /** Revokes any object URL this source owns. Safe to call more than once. */
  dispose(): void;
}

export function sourceFromMediaItem(item: MediaItem): PlaybackSource {
  return {
    key: `server:${item.id}`,
    title: item.title,
    subtitle: item.subtitle,
    filename: item.filename,
    src: item.streamUrl,
    // The server ignores query params; this only separates the cache entries.
    previewSrc: `${item.streamUrl}?preview=1`,
    subtitles: item.subtitles,
    likelyPlayable: item.likelyPlayable,
    ext: item.ext,
    probe: () => fetchProbe(item.id),
    dispose: () => {},
  };
}

const BROWSER_FRIENDLY = new Set(["mp4", "m4v", "webm", "ogv", "ogg", "mov", "mkv"]);

export function sourceFromFile(file: File): PlaybackSource {
  const url = URL.createObjectURL(file);
  // A second handle to the same blob, for the same reason as previewSrc above.
  const previewUrl = URL.createObjectURL(file);
  const dot = file.name.lastIndexOf(".");
  const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  const base = dot > 0 ? file.name.slice(0, dot) : file.name;

  let revoked = false;

  return {
    // Name + size is a good enough identity for resuming a dropped file.
    key: `local:${file.name}:${file.size}`,
    title: base.replace(/[._]+/g, " ").trim() || file.name,
    subtitle: null,
    filename: file.name,
    src: url,
    previewSrc: previewUrl,
    subtitles: [],
    likelyPlayable: BROWSER_FRIENDLY.has(ext),
    ext,
    // Reads a few KB via File.slice(); nothing is uploaded.
    probe: () => probeLocalFile(file, ext),
    dispose: () => {
      if (revoked) return;
      revoked = true;
      URL.revokeObjectURL(url);
      URL.revokeObjectURL(previewUrl);
    },
  };
}

export type { MediaItem, SubtitleTrack };
