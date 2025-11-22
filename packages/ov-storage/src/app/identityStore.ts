import { BUCKET, minioClient, streamToBuffer } from "./minio.js";

export async function putJson(path: string, data: unknown): Promise<void> {
  await minioClient.putObject(
    BUCKET,
    path,
    Buffer.from(JSON.stringify(data)),
    undefined,
    { "Content-Type": "application/json" }
  );
}

export async function getJson<T>(path: string): Promise<T | null> {
  const stat = await minioClient.statObject(BUCKET, path).catch(() => null);
  if (!stat) return null;
  const stream = await minioClient.getObject(BUCKET, path);
  const buf = await streamToBuffer(stream);
  return JSON.parse(buf.toString());
}

export function identityPathByContentHash(contentHash: string): string {
  return `indexes/identities/${contentHash}.json`;
}

export function fileMapPathByUser(userDid: string, fileId: string): string {
  return `indexes/${userDid}/file_map/${fileId}.json`;
}

export function fileMapPathByUsername(username: string, fileId: string): string {
  return `indexes/${username}/${fileId}.json`;
}


