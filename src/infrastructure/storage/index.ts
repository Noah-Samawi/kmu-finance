import "server-only";
import { AppError } from "@/domain/errors";
import { localStorage } from "./local";
import { s3Storage } from "./s3";
import type { Storage } from "./types";
import { vercelBlobStorage } from "./vercel-blob";

function backend(): Storage {
  if (process.env.BLOB_READ_WRITE_TOKEN) return vercelBlobStorage;
  if (process.env.S3_BUCKET) return s3Storage;
  if (process.env.VERCEL) {
    const missing: Storage = {
      async put() {
        throw new AppError(
          503,
          "STORAGE",
          "Dateispeicher fehlt: auf Vercel BLOB_READ_WRITE_TOKEN (Vercel Blob) oder S3_BUCKET setzen.",
        );
      },
      async get() {
        throw new AppError(
          503,
          "STORAGE",
          "Dateispeicher fehlt: auf Vercel BLOB_READ_WRITE_TOKEN (Vercel Blob) oder S3_BUCKET setzen.",
        );
      },
    };
    return missing;
  }
  return localStorage;
}

export const storage: Storage = backend();
export type { Storage } from "./types";
