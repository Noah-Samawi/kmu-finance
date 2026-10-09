import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Storage } from "./types";

function client() {
  const region = process.env.S3_REGION ?? process.env.AWS_REGION ?? "eu-central-1";
  return new S3Client({
    region,
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: !!process.env.S3_ENDPOINT,
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.S3_ACCESS_KEY_ID,
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
          }
        : undefined,
  });
}

function bucket() {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error("S3_BUCKET fehlt");
  return b;
}

export const s3Storage: Storage = {
  async put(key, data, mime) {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: Buffer.isBuffer(data) ? data : Buffer.from(data),
        ContentType: mime,
      }),
    );
  },
  async get(key) {
    const out = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
    const bytes = await out.Body?.transformToByteArray();
    if (!bytes) throw new Error(`S3-Objekt leer: ${key}`);
    return Buffer.from(bytes);
  },
};
