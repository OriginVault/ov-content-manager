import { BUCKET, minioClient, streamToBuffer } from "./minio.js";
export async function putJson(path, data) {
    await minioClient.putObject(BUCKET, path, Buffer.from(JSON.stringify(data)), undefined, { "Content-Type": "application/json" });
}
export async function getJson(path) {
    const stat = await minioClient.statObject(BUCKET, path).catch(() => null);
    if (!stat)
        return null;
    const stream = await minioClient.getObject(BUCKET, path);
    const buf = await streamToBuffer(stream);
    return JSON.parse(buf.toString());
}
export function identityPathByContentHash(contentHash) {
    return `indexes/identities/${contentHash}.json`;
}
export function fileMapPathByUser(userDid, fileId) {
    return `indexes/${userDid}/file_map/${fileId}.json`;
}
export function fileMapPathByUsername(username, fileId) {
    return `indexes/${username}/${fileId}.json`;
}
