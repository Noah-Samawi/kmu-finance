import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Dateiablage für Belege und Rechnungs-PDFs.
// Schnittstelle bewusst minimal -> später 1:1 durch S3/MinIO ersetzbar.
export interface Storage {
  put(key: string, data: Buffer | Uint8Array): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");

function safePath(key: string) {
  // Keys werden nur serverseitig erzeugt; trotzdem gegen Path Traversal absichern
  if (!/^[A-Za-z0-9_\-/.]+$/.test(key) || key.includes("..")) throw new Error("Ungültiger Storage-Key");
  return path.join(ROOT, key);
}

export const storage: Storage = {
  async put(key, data) {
    const p = safePath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  },
  async get(key) {
    return readFile(safePath(key));
  },
};
