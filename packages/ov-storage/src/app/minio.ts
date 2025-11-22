import * as Minio from "minio";
import { loadConfig } from "./config.js";

const config = loadConfig();

export const minioClient = new Minio.Client({
  endPoint: config.minio.endPoint,
  port: config.minio.port,
  accessKey: config.minio.accessKey,
  secretKey: config.minio.secretKey,
  useSSL: config.minio.useSSL,
});

export const BUCKET = config.minio.bucket;

export async function ensureBucket(): Promise<void> {
  const exists = await minioClient.bucketExists(BUCKET).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(BUCKET).catch(() => undefined);
  }
}

export function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}


