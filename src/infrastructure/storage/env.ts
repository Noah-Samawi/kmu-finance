/** Dynamischer Zugriff — Next.js darf den Wert nicht zur Build-Zeit auf undefined inlinen. */
export function envStr(name: string): string | undefined {
  const v = process.env[name];
  if (typeof v !== "string") return undefined;
  const t = v.trim().replace(/^["']|["']$/g, "");
  return t || undefined;
}

export function blobToken(): string | undefined {
  const raw =
    process.env.BLOB_READ_WRITE_TOKEN ||
    process.env.VERCEL_BLOB_READ_WRITE_TOKEN ||
    envStr("BLOB_READ_WRITE_TOKEN") ||
    envStr("VERCEL_BLOB_READ_WRITE_TOKEN");
  if (typeof raw !== "string") return undefined;
  const t = raw.trim().replace(/^["']|["']$/g, "");
  return t || undefined;
}

export function blobTokenSource(): "BLOB_READ_WRITE_TOKEN" | "VERCEL_BLOB_READ_WRITE_TOKEN" | null {
  if (envStr("BLOB_READ_WRITE_TOKEN") || process.env.BLOB_READ_WRITE_TOKEN?.trim()) return "BLOB_READ_WRITE_TOKEN";
  if (envStr("VERCEL_BLOB_READ_WRITE_TOKEN") || process.env.VERCEL_BLOB_READ_WRITE_TOKEN?.trim()) {
    return "VERCEL_BLOB_READ_WRITE_TOKEN";
  }
  return null;
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
    blobTokenSource: blobTokenSource(),
    blobTokenLength: token?.length ?? 0,
    blobTokenPrefix: token ? `${token.slice(0, 12)}…` : null,
    blobStoreIdPresent: Boolean(envStr("BLOB_STORE_ID")),
    s3BucketPresent: Boolean(envStr("S3_BUCKET")),
    databaseUrlPresent: Boolean(db),
    databaseHost,
  };
}
