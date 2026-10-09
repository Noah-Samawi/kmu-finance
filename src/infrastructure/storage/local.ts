import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Storage } from "./types";

const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");

function safePath(key: string) {
  if (!/^[A-Za-z0-9_\-/.]+$/.test(key) || key.includes("..")) throw new Error("Ungültiger Storage-Key");
  return path.join(ROOT, key);
}

export const localStorage: Storage = {
  async put(key, data) {
    const p = safePath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  },
  async get(key) {
    return readFile(safePath(key));
  },
};

/** @deprecated Import aus `@/infrastructure/storage` */
export const storage = localStorage;
export type { Storage };
