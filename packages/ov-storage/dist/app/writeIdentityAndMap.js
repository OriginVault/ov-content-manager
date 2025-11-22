import { BUCKET, minioClient } from "./minio.js";
import { putJson } from "./identityStore.js";
export async function writeIdentityAndMap(identity) {
    const identityPath = `indexes/identities/${identity.contentHash}.json`;
    await putJson(identityPath, identity);
    const fileMapData = {
        id: identity.id,
        fileName: identity.fileName,
        path: identity.path,
        publicPath: identity.publicPath,
        uploadedAt: new Date().toISOString(),
        identityRef: identityPath,
    };
    const indexBase = identity.username ? `indexes/${identity.username}` : `indexes/${identity.userDID}/file_map`;
    const fileMapPath = `${indexBase}/${identity.id}.json`;
    await minioClient.putObject(BUCKET, fileMapPath, Buffer.from(JSON.stringify(fileMapData)), undefined, { "Content-Type": "application/json" });
    return { identityPath, fileMapPath };
}
