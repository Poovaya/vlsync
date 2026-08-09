/**
 * Prints the codecs actually stored in an MP4, so you can tell at a glance why
 * a file plays silently or shows no picture.
 *
 *   node scripts/probe.ts "C:/path/to/file.mp4"
 */
import { probeFile } from "../server/probe.ts";

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/probe.ts "<file.mp4>"');
  process.exit(1);
}

const result = await probeFile(target);
if (!result) {
  console.error("Could not read this file as MP4/MOV.");
  process.exit(2);
}

console.log(`container:  ${result.container}`);
console.log(`faststart:  ${result.fastStart ? "yes" : "no (moov after mdat)"}`);

if (result.durationSeconds !== null) {
  const total = Math.round(result.durationSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  console.log(`duration:   ${hours}h ${String(minutes).padStart(2, "0")}m`);
}

if (result.video) {
  const { label, format, width, height } = result.video;
  console.log(`video:      ${label} [${format}] ${width ?? "?"}x${height ?? "?"}`);
}

for (const track of result.audio) {
  const channels = track.channels ? `${track.channels}ch` : "?ch";
  const rate = track.sampleRate ? `${track.sampleRate} Hz` : "";
  console.log(`audio:      ${track.label} [${track.format}] ${channels} ${rate}`.trimEnd());
}

if (result.embeddedSubtitles > 0) {
  console.log(`subtitles:  ${result.embeddedSubtitles} embedded (browsers cannot display these)`);
}
