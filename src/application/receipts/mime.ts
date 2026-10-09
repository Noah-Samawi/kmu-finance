/** Handy-Uploads schicken oft einen leeren oder ungenauen MIME-Typ. */

export const ALLOWED_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "application/pdf": "pdf",
};

export function resolveReceiptMime(declared: string, data: Buffer): string | undefined {
  const d = declared.trim().toLowerCase();
  if (ALLOWED_MIME[d]) return d === "image/jpg" ? "image/jpeg" : d;

  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return "image/png";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (data.length >= 5 && data.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  if (data.length >= 12 && data.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = data.subarray(8, 12).toString("ascii").toLowerCase();
    if (brand.startsWith("hei") || brand === "mif1") return brand.startsWith("heif") ? "image/heif" : "image/heic";
  }
  return undefined;
}
