import type { ProbeResult, TrackInfo } from "../shared/types.ts";

export interface CompatIssue {
  kind: "audio" | "video" | "subtitles";
  /** One-line explanation shown in the player. */
  message: string;
  /** A concrete ffmpeg command that fixes it, when one exists. */
  fix?: string;
}

/**
 * Compare what is in the file against what this browser will actually decode.
 *
 * We ask the browser rather than hardcoding a support matrix: Dolby support in
 * particular varies by build and platform (Safari and Edge often decode E-AC-3
 * where Chrome does not), so the same file is genuinely fine in one browser and
 * silent in another.
 */
export function findCompatIssues(
  probe: ProbeResult,
  video: HTMLVideoElement,
  filename: string,
  hasSidecarSubtitles: boolean,
): CompatIssue[] {
  const issues: CompatIssue[] = [];
  const quoted = quoteForShell(filename);

  const videoSupported = probe.video ? canPlay(video, probe.video) : true;
  const audioSupported = probe.audio.map((track) => canPlay(video, track));

  if (probe.video && !videoSupported) {
    issues.push({
      kind: "video",
      message: `Video is ${probe.video.label}, which this browser can't decode — you'll get sound but no picture.`,
      fix: `ffmpeg -i ${quoted} -c:v libx264 -c:a aac out.mp4`,
    });
  }

  // Only complain about audio when *no* track is playable; multi-track files
  // often pair an undecodable surround track with a plain stereo AAC one.
  const anyAudioPlayable = audioSupported.some(Boolean);

  if (probe.audio.length > 0 && !anyAudioPlayable) {
    const first = probe.audio[0];
    const channels = first?.channels ? `, ${describeChannels(first.channels)}` : "";
    issues.push({
      kind: "audio",
      message: `Audio is ${first?.label ?? "an unsupported codec"}${channels}, which this browser can't decode — the video will play silently.`,
      // Re-encode audio only; copying the video stream keeps this near-instant
      // and lossless for the picture.
      fix: `ffmpeg -i ${quoted} -c:v copy -c:a aac -ac 2 -b:a 256k out.mp4`,
    });
  }

  // A playable track that is not first: browsers pick the default track and
  // cannot switch, so this still plays silently despite a usable track.
  const misorderedAudio =
    anyAudioPlayable && audioSupported.length > 1 && audioSupported[0] === false;

  if (misorderedAudio) {
    const index = audioSupported.findIndex(Boolean);
    issues.push({
      kind: "audio",
      message: `The default audio track is ${probe.audio[0]?.label ?? "unsupported"}, but track ${index + 1} (${probe.audio[index]?.label ?? "?"}) would play. Browsers can't switch tracks, so it's silent.`,
      fix: `ffmpeg -i ${quoted} -map 0:v -map 0:a:${index} -c copy out.mp4`,
    });
  }

  if (probe.embeddedSubtitles > 0 && !hasSidecarSubtitles) {
    issues.push({
      kind: "subtitles",
      message: `This file has ${probe.embeddedSubtitles} embedded subtitle ${
        probe.embeddedSubtitles === 1 ? "track" : "tracks"
      }, which browsers can't display. Extract them next to the video as .srt.`,
      fix: `ffmpeg -i ${quoted} -map 0:s:0 out.srt`,
    });
  }

  return issues;
}

function canPlay(video: HTMLVideoElement, track: TrackInfo): boolean {
  if (!track.mime) return true; // Unknown codec: do not cry wolf.
  return video.canPlayType(track.mime) !== "";
}

function describeChannels(channels: number): string {
  if (channels === 1) return "mono";
  if (channels === 2) return "stereo";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return `${channels} channels`;
}

function quoteForShell(filename: string): string {
  return /[\s"'()[\]&]/.test(filename) ? `"${filename.replace(/"/g, '\\"')}"` : filename;
}
