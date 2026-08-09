import { probeMp4, type ByteReader } from "../shared/mp4probe.ts";
import type { ProbeResult } from "../shared/types.ts";

const MP4_EXTENSIONS = new Set(["mp4", "m4v", "mov"]);

/**
 * Probe a file the user dropped in, without uploading anything: File.slice()
 * reads only the handful of byte ranges the parser asks for, so a 5 GB file
 * costs a few KB.
 */
export async function probeLocalFile(file: File, ext: string): Promise<ProbeResult | null> {
  if (!MP4_EXTENSIONS.has(ext)) return null;

  const reader: ByteReader = {
    size: file.size,
    async read(offset, length) {
      const end = Math.min(offset + length, file.size);
      if (end <= offset) return new Uint8Array(0);
      const buffer = await file.slice(offset, end).arrayBuffer();
      return new Uint8Array(buffer);
    },
  };

  return probeMp4(reader);
}

/** Ask the server what is inside a library file. 204 means "not an MP4". */
export async function fetchProbe(mediaId: string): Promise<ProbeResult | null> {
  try {
    const response = await fetch(`/api/probe/${mediaId}`);
    if (response.status === 204 || !response.ok) return null;
    return (await response.json()) as ProbeResult;
  } catch {
    return null;
  }
}
