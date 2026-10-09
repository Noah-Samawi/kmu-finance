import { get, put, type BlobAccessType } from "@vercel/blob";
import { AppError } from "@/domain/errors";
import { blobToken } from "./env";
import type { Storage } from "./types";

function asBuffer(data: Buffer | Uint8Array): Buffer {
  return Buffer.isBuffer(data) ? data : Buffer.from(data);
}

const accessOrder: BlobAccessType[] = ["public", "private"];

function tokenOpts() {
  const token = blobToken();
  return token ? { token } : {};
}

export const vercelBlobStorage: Storage = {
  async put(key, data, mime) {
    const body = asBuffer(data);
    const token = blobToken();
    console.info("[storage:blob] put start", {
      key,
      bytes: body.length,
      mime,
      tokenPresent: Boolean(token),
      tokenLength: token?.length ?? 0,
      tokenPrefix: token ? `${token.slice(0, 12)}…` : null,
    });
    const base = {
      ...tokenOpts(),
      addRandomSuffix: false as const,
      allowOverwrite: true,
      contentType: mime,
      multipart: body.length > 4 * 1024 * 1024,
    };
    let last: unknown;
    for (const access of accessOrder) {
      try {
        await put(key, body, { ...base, access });
        console.info("[storage:blob] put ok", { key, access });
        return;
      } catch (e) {
        last = e;
        console.error("[storage:blob] put failed", {
          key,
          access,
          name: e instanceof Error ? e.name : typeof e,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const msg = last instanceof Error ? last.message : "Vercel Blob: Upload fehlgeschlagen";
    throw new AppError(503, "STORAGE", `Vercel Blob Store: ${msg}`);
  },
  async get(key) {
    const token = blobToken();
    console.info("[storage:blob] get start", { key, tokenPresent: Boolean(token) });
    for (const access of accessOrder) {
      try {
        const result = await get(key, { access, ...tokenOpts() });
        if (result?.stream) {
          console.info("[storage:blob] get ok", { key, access });
          return Buffer.from(await new Response(result.stream).arrayBuffer());
        }
      } catch (e) {
        console.error("[storage:blob] get failed", {
          key,
          access,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
    throw new AppError(404, "NOT_FOUND", `Blob nicht gefunden: ${key}`);
  },
};
