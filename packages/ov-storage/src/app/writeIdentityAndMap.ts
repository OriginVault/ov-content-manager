import { BUCKET, minioClient } from "./minio.js";
import { putJson } from "./identityStore.js";

export interface IdentityRecord {
  contentHash: string;
  softPerceptualHash: string;
  mediumPerceptualHash: string;
  precisePerceptualHash: string;
  userDID: string;
  username?: string;
  id: string;
  fileName: string;
  path: string;
  publicPath?: string;
  createdAt: string;
  status: "pending" | "complete";
  color?: string;
  colorCode?: string;
  mnemonicId: string;
}

export interface FileMapRecord {
  id: string;
  fileName: string;
  path: string;
  publicPath?: string;
  uploadedAt: string;
  identityRef: string;
}

export async function writeIdentityAndMap(identity: IdentityRecord): Promise<{ identityPath: string; fileMapPath: string; }>{
  const identityPath = `indexes/identities/${identity.contentHash}.json`;
  await putJson(identityPath, identity);

  const fileMapData: FileMapRecord = {
    id: identity.id,
    fileName: identity.fileName,
    path: identity.path,
    publicPath: identity.publicPath,
    uploadedAt: new Date().toISOString(),
    identityRef: identityPath,
  };

  const indexBase = identity.username ? `indexes/${identity.username}` : `indexes/${identity.userDID}/file_map`;
  const fileMapPath = `${indexBase}/${identity.id}.json`;

  await minioClient.putObject(
    BUCKET,
    fileMapPath,
    Buffer.from(JSON.stringify(fileMapData)),
    undefined,
    { "Content-Type": "application/json" }
  );

  return { identityPath, fileMapPath };
}


