import type { ProbeResult, TrackInfo } from "./types.ts";

/**
 * Reads the codec 4CCs actually stored in an MP4/MOV.
 *
 * "The picture plays but there is no sound" is nearly always an audio codec the
 * browser cannot decode — Dolby Digital Plus (`ec-3`) above all, since it ships
 * in most WEB-DL releases and Chrome will not touch it. The filename hints at
 * this but is not evidence, so we read the container.
 *
 * Written against an abstract reader so the server (a file handle) and the
 * browser (a dropped File) share one parser. Only box *headers* are read while
 * walking the tree; the sample description (`stsd`) is the sole box pulled in
 * whole, and it is a few hundred bytes. A 5 GB file costs a handful of reads.
 */

export interface ByteReader {
  readonly size: number;
  /** Resolve with up to `length` bytes at `offset`; may return fewer at EOF. */
  read(offset: number, length: number): Promise<Uint8Array>;
}

interface Box {
  type: string;
  start: number; // payload offset
  end: number; // exclusive
}

/** Guards against a corrupt file describing an absurd number of boxes. */
const MAX_BOXES = 512;
const MAX_STSD_BYTES = 1 << 20;

export async function probeMp4(reader: ByteReader): Promise<ProbeResult | null> {
  try {
    const top = await readBoxes(reader, 0, reader.size);

    const moovIndex = top.findIndex((b) => b.type === "moov");
    if (moovIndex === -1) return null;
    const moov = top[moovIndex];
    if (!moov) return null;

    const ftyp = top.find((b) => b.type === "ftyp");
    const brand = ftyp ? fourCC(await readBox(reader, ftyp), 0).trim() : "";

    const mdatIndex = top.findIndex((b) => b.type === "mdat");

    const result: ProbeResult = {
      container: brand || "mp4",
      video: null,
      audio: [],
      embeddedSubtitles: 0,
      // moov after mdat means the file was not "faststart"ed: the browser must
      // range-request the tail before it can begin. Harmless locally.
      fastStart: mdatIndex === -1 || moovIndex < mdatIndex,
      durationSeconds: null,
    };

    const moovChildren = await readBoxes(reader, moov.start, moov.end);

    const mvhd = findChild(moovChildren, "mvhd");
    if (mvhd) result.durationSeconds = parseMovieDuration(await readBox(reader, mvhd));

    const traks = moovChildren.filter((b) => b.type === "trak");

    for (const trak of traks) {
      const mdia = findChild(await readBoxes(reader, trak.start, trak.end), "mdia");
      if (!mdia) continue;

      const mdiaBoxes = await readBoxes(reader, mdia.start, mdia.end);

      const hdlr = findChild(mdiaBoxes, "hdlr");
      if (!hdlr) continue;
      const handler = fourCC(await readBox(reader, hdlr), 8);

      const minf = findChild(mdiaBoxes, "minf");
      if (!minf) continue;
      const stbl = findChild(await readBoxes(reader, minf.start, minf.end), "stbl");
      if (!stbl) continue;
      const stsd = findChild(await readBoxes(reader, stbl.start, stbl.end), "stsd");
      if (!stsd || stsd.end - stsd.start > MAX_STSD_BYTES) continue;

      const track = parseSampleDescription(await readBox(reader, stsd), handler);

      if (handler === "vide") {
        if (track && !result.video) result.video = track;
      } else if (handler === "soun") {
        if (track) result.audio.push(track);
      } else if (handler === "sbtl" || handler === "subt" || handler === "text") {
        result.embeddedSubtitles += 1;
      }
    }

    return result;
  } catch {
    return null;
  }
}

async function readBoxes(reader: ByteReader, from: number, to: number): Promise<Box[]> {
  const boxes: Box[] = [];
  let offset = from;

  while (offset + 8 <= to && boxes.length < MAX_BOXES) {
    const header = await reader.read(offset, 16);
    if (header.length < 8) break;

    const view = new DataView(header.buffer, header.byteOffset, header.byteLength);

    let size = view.getUint32(0);
    const type = fourCC(header, 4);
    let headerSize = 8;

    if (size === 1) {
      // 64-bit largesize — mandatory once a box (usually mdat) passes 4 GB.
      if (header.length < 16) break;
      size = Number(view.getBigUint64(8));
      headerSize = 16;
    } else if (size === 0) {
      size = to - offset; // runs to the end of its parent
    }

    if (size < headerSize || !Number.isSafeInteger(size)) break;

    boxes.push({ type, start: offset + headerSize, end: Math.min(offset + size, to) });
    offset += size;
  }

  return boxes;
}

function findChild(boxes: Box[], type: string): Box | undefined {
  return boxes.find((b) => b.type === type);
}

async function readBox(reader: ByteReader, box: Box): Promise<Uint8Array> {
  const length = Math.max(0, box.end - box.start);
  return length === 0 ? new Uint8Array(0) : reader.read(box.start, length);
}

function fourCC(bytes: Uint8Array, offset: number): string {
  if (bytes.length < offset + 4) return "";
  return String.fromCharCode(
    bytes[offset] ?? 0,
    bytes[offset + 1] ?? 0,
    bytes[offset + 2] ?? 0,
    bytes[offset + 3] ?? 0,
  );
}

/**
 * Runtime from the movie header. Version 0 stores 32-bit timescale/duration,
 * version 1 widens both — long films and high timescales need the 64-bit form.
 */
function parseMovieDuration(data: Uint8Array): number | null {
  if (data.length < 20) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint8(0);

  let timescale: number;
  let duration: number;

  if (version === 1) {
    if (data.length < 32) return null;
    timescale = view.getUint32(20);
    duration = Number(view.getBigUint64(24));
  } else {
    timescale = view.getUint32(12);
    duration = view.getUint32(16);
  }

  if (!timescale || !Number.isFinite(duration)) return null;
  // 0xFFFFFFFF is the documented "unknown duration" sentinel.
  if (version === 0 && duration === 0xffffffff) return null;

  return duration / timescale;
}

function parseSampleDescription(data: Uint8Array, handler: string): TrackInfo | null {
  if (data.length < 16) return null;

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(4) === 0) return null; // entry_count

  const format = fourCC(data, 12);
  const track: TrackInfo = {
    format,
    label: describeCodec(format),
    mime: mimeFor(format, handler),
  };

  // AudioSampleEntry: 6 reserved + 2 index + 8 reserved, then channels/size/rate.
  if (handler === "soun" && data.length >= 44) {
    track.channels = view.getUint16(32);
    track.sampleRate = view.getUint32(40) >>> 16;
  }
  if (handler === "vide" && data.length >= 44) {
    track.width = view.getUint16(40);
    track.height = view.getUint16(42);
  }

  return track;
}

const CODEC_LABELS: Record<string, string> = {
  avc1: "H.264",
  avc3: "H.264",
  hev1: "HEVC (H.265)",
  hvc1: "HEVC (H.265)",
  av01: "AV1",
  vp09: "VP9",
  mp4v: "MPEG-4 Visual",

  mp4a: "AAC",
  "ec-3": "Dolby Digital Plus (E-AC-3)",
  "ac-3": "Dolby Digital (AC-3)",
  "ac-4": "Dolby AC-4",
  dtsc: "DTS",
  dtse: "DTS Express",
  dtsh: "DTS-HD",
  dtsl: "DTS-HD Lossless",
  alac: "Apple Lossless",
  fLaC: "FLAC",
  Opus: "Opus",
  ".mp3": "MP3",

  tx3g: "3GPP Timed Text",
  text: "QuickTime Text",
};

function describeCodec(format: string): string {
  return CODEC_LABELS[format] ?? format;
}

/**
 * A MIME string the browser can be asked about with canPlayType(). We
 * deliberately do not invent profile/level suffixes we did not read — a wrong
 * `avc1.640028` would yield a confident but meaningless answer.
 */
function mimeFor(format: string, handler: string): string | null {
  const kind = handler === "soun" ? "audio" : handler === "vide" ? "video" : null;
  if (!kind) return null;

  const normalized = format.toLowerCase();

  // Codec ids MP4 uses verbatim inside a codecs= parameter.
  const passthrough = new Set([
    "ec-3", "ac-3", "ac-4", "opus", "alac", "flac",
    "dtsc", "dtse", "dtsh", "dtsl",
  ]);

  if (passthrough.has(normalized)) return `${kind}/mp4; codecs="${normalized}"`;
  if (normalized === "mp4a") return 'audio/mp4; codecs="mp4a.40.2"'; // AAC-LC
  if (normalized === "avc1" || normalized === "avc3") return 'video/mp4; codecs="avc1.42E01E"';
  if (normalized === "hev1" || normalized === "hvc1") return 'video/mp4; codecs="hvc1.1.6.L93.B0"';
  if (normalized === "av01") return 'video/mp4; codecs="av01.0.05M.08"';
  if (normalized === "vp09") return 'video/mp4; codecs="vp09.00.10.08"';

  return null;
}
