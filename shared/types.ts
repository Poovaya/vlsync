/**
 * Types shared by the media server and the browser client.
 * Keep this file dependency-free so both tsconfig projects can include it.
 */

export interface SubtitleTrack {
  /** Stable id, used in the /api/subtitle URL. */
  id: string;
  /** BCP-47-ish language code parsed from the filename, e.g. "en", "pt-BR". */
  lang: string;
  /** Human label shown in the subtitles menu, e.g. "English". */
  label: string;
  /** URL the <track> element points at. Always served as WebVTT. */
  url: string;
  /** True when the sidecar was SRT and gets converted on the fly. */
  converted: boolean;
}

export interface MediaItem {
  /** Opaque, URL-safe id encoding (root index, relative path). */
  id: string;
  /** Filename without extension, cleaned up for display. */
  title: string;
  /** Secondary line: season/episode, or the containing folder. */
  subtitle: string | null;
  /** Raw filename including extension. */
  filename: string;
  /** Path relative to its media root, using forward slashes. */
  relPath: string;
  /** Index of the media root this file came from. */
  rootIndex: number;
  /** Lowercased extension without the dot. */
  ext: string;
  /** Size in bytes. */
  size: number;
  /** Last modified, epoch milliseconds. */
  mtimeMs: number;
  /** Streaming URL for the <video> element. */
  streamUrl: string;
  /** Sidecar subtitle tracks discovered next to the file. */
  subtitles: SubtitleTrack[];
  /**
   * Whether browsers can usually decode this container/codec combination.
   * Containers like .mkv or .avi are listed but flagged so the UI can warn
   * instead of silently showing a black screen.
   */
  likelyPlayable: boolean;
}

export interface MediaRootInfo {
  index: number;
  path: string;
  label: string;
  exists: boolean;
  fileCount: number;
}

export interface LibraryResponse {
  roots: MediaRootInfo[];
  items: MediaItem[];
  scannedAt: number;
  truncated: boolean;
}

export interface ApiError {
  error: string;
  detail?: string;
}

export interface TrackInfo {
  /** Container 4CC, e.g. "avc1", "ec-3", "mp4a". */
  format: string;
  /** Human-readable codec name for the UI. */
  label: string;
  /** MIME + codecs string for canPlayType(), or null when we cannot build one. */
  mime: string | null;
  channels?: number;
  sampleRate?: number;
  width?: number;
  height?: number;
}

/** Result of reading an MP4's actual codecs. Null for non-MP4 containers. */
export interface ProbeResult {
  container: string;
  video: TrackInfo | null;
  audio: TrackInfo[];
  embeddedSubtitles: number;
  /** False when moov sits after mdat, i.e. the file was not "faststart"ed. */
  fastStart: boolean;
  /** Runtime from the movie header. Handy for confirming a file is complete. */
  durationSeconds: number | null;
}
