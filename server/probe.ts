import fs from "node:fs/promises";
import { probeMp4, type ByteReader } from "../shared/mp4probe.ts";
import type { ProbeResult } from "../shared/types.ts";

/** Adapter over an open file handle; the parser lives in shared/mp4probe.ts. */
export async function probeFile(path: string): Promise<ProbeResult | null> {
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path, "r");
  } catch {
    return null;
  }

  try {
    const { size } = await handle.stat();

    const reader: ByteReader = {
      size,
      async read(offset, length) {
        const buf = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buf, 0, length, offset);
        return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
      },
    };

    return await probeMp4(reader);
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => {});
  }
}
