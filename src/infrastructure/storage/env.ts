/** Dynamischer Zugriff — Next.js darf den Wert nicht zur Build-Zeit auf undefined inlinen. */
export function envStr(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/^["']|["']$/g, "");
  return t || undefined;
}

export function blobToken(): string | undefined {
  return envStr("BLOB_READ_WRITE_TOKEN");
}

export type StorageBackendName = "vercel-blob" | "s3" | "local" | "missing";

export function selectedBackend(): StorageBackendName {
  if (blobToken() || envStr("BLOB_STORE_ID")) return "vercel-blob";
  if (envStr("S3_BUCKET")) return "s3";
  if (process.env.VERCEL) return "missing";
  return "local";
}

export function storageDiagnostics() {
  const token = blobToken();
  const db = envStr("DATABASE_URL");
  let databaseHost: string | null = null;
  if (db) {
    try {
      databaseHost = new URL(db).host;
    } catch {
      databaseHost = "(ungültige URL)";
    }
  }
  return {
    vercel: Boolean(process.env.VERCEL),
    backend: selectedBackend(),
    blobTokenPresent: Boolean(token),
    blobTokenLength: token?.length ?? 0,
    blobTokenPrefix: token ? `${token.slice(0, 12)}…` : null,
    blobStoreIdPresent: Boolean(envStr("BLOB_STORE_ID")),
    s3BucketPresent: Boolean(envStr("S3_BUCKET")),
    databaseUrlPresent: Boolean(db),
    databaseHost,
  };
}
