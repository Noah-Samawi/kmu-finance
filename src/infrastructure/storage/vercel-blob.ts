import { get, put, type BlobAccessType } from "@vercel/blob";
import type { Storage } from "./types";

function asBuffer(data: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

const accessOrder: BlobAccessType[] = ["public", "private"];

export const vercelBlobStorage: Storage = {
  async put(key, data, mime) {
    const body = asBuffer(data);
    const base = { addRandomSuffix: false as const, allowOverwrite: true, contentType: mime };
    let last: unknown;
    for (const access of accessOrder) {
      try {
        await put(key, body, { ...base, access });
        return;
      } catch (e) {
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error("Vercel Blob: Upload fehlgeschlagen");
  },
  async get(key) {
    for (const access of accessOrder) {
      try {
        const result = await get(key, { access });
        if (result?.stream) return Buffer.from(await new Response(result.stream).arrayBuffer());
      } catch {
        /* anderen access-Modus versuchen */
      }
    }
    throw new Error(`Blob nicht gefunden: ${key}`);
  },
};
