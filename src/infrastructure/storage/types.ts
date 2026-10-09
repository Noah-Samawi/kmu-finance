export interface Storage {
  put(key: string, data: Buffer | Uint8Array, mime?: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}
