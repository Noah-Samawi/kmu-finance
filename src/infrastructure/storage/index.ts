import "server-only";
import { AppError } from "@/domain/errors";
import { selectedBackend, storageDiagnostics } from "./env";
import { localStorage } from "./local";
import { s3Storage } from "./s3";
import type { Storage } from "./types";
import { vercelBlobStorage } from "./vercel-blob";

const missingStorage: Storage = {
  async put() {
    console.error("[storage] kein Backend konfiguriert", storageDiagnostics());
    throw new AppError(
      503,
      "STORAGE",
      "Dateispeicher fehlt: auf Vercel BLOB_READ_WRITE_TOKEN (Vercel Blob) oder S3_BUCKET setzen.",
    );
  },
  async get() {
    console.error("[storage] kein Backend konfiguriert", storageDiagnostics());
    throw new AppError(
      503,
      "STORAGE",
      "Dateispeicher fehlt: auf Vercel BLOB_READ_WRITE_TOKEN (Vercel Blob) oder S3_BUCKET setzen.",
    );
  },
};

function backend(): Storage {
  switch (selectedBackend()) {
    case "vercel-blob":
      return vercelBlobStorage;
    case "s3":
      return s3Storage;
    case "missing":
      return missingStorage;
    default:
      return localStorage;
  }
}

/** Pro Aufruf neu wählen, damit Env-Vars zur Request-Zeit (nicht zur Build-Zeit) gelten. */
export const storage: Storage = {
  put: (key, data, mime) => backend().put(key, data, mime),
  get: (key) => backend().get(key),
};

export { storageDiagnostics, selectedBackend, blobToken } from "./env";
export type { Storage } from "./types";
