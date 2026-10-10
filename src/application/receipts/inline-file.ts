/** Belegdatei als Data-URL in der Spalte `Receipt.fileKey` (kein Blob-Store nötig). */

export function toReceiptDataUrl(mime: string, data: Buffer): string {
  return `data:${mime};base64,${data.toString("base64")}`;
}

export function parseReceiptDataUrl(fileKey: string): { mime: string; data: Buffer } | null {
  if (!fileKey.startsWith("data:")) return null;
  const i = fileKey.indexOf(";base64,");
  if (i < 5) return null;
  const mime = fileKey.slice("data:".length, i);
  const b64 = fileKey.slice(i + ";base64,".length);
  if (!mime || !b64) return null;
  return { mime, data: Buffer.from(b64, "base64") };
}
