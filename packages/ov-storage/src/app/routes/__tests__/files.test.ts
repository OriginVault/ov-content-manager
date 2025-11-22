import request from "supertest";
import { createApp } from "../../createApp.js";

// Mock auth to always allow
jest.mock("../../auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => next(),
}));

// Mock ID functions
jest.mock("../../ids", () => ({
  generateSnowflakeId: jest.fn(() => "123456789"),
  snowflakeToMnemonic: jest.fn((snowflake: string) => `mnemonic-${snowflake}`),
  mnemonicToSnowflake: jest.fn((mnemonic: string) => {
    // Handle the test case where mnemonic is "test mnemonic"
    if (mnemonic === "test mnemonic") return "123456789";
    return mnemonic.replace("mnemonic-", "");
  }),
}));

// Mock MinIO methods used by routes
jest.mock("../../minio", () => {
  const putCalls: any[] = [];
  const objects: Record<string, any> = {};
  
  // Pre-populate with some test data
  objects["users/did_cheqd_test/uploads/test.jpg/123456789"] = "test file content";
  objects["users/did:cheqd:test/uploads/123456789"] = "test file content"; // For delete test
  // Add private file for publish test
  objects["users/did_cheqd_test/uploads/test.jpg/123456789"] = "test file content";
  objects["indexes/did:cheqd:test/file_map/123456789.json"] = JSON.stringify({
    id: "123456789",
    fileName: "test.jpg",
    path: "users/did_cheqd_test/uploads/test.jpg/123456789",
    uploadedAt: new Date().toISOString(),
    identityRef: "indexes/identities/hash1.json"
  });
  objects["indexes/alice/123456789.json"] = JSON.stringify({
    id: "123456789",
    fileName: "test.jpg",
    path: "public/alice/123456789",
    uploadedAt: new Date().toISOString(),
    identityRef: "indexes/identities/hash1.json"
  });
  // Add entries for mnemonic-based lookups
  objects["indexes/did:cheqd:test/file_map/mnemonic-123456789.json"] = JSON.stringify({
    id: "123456789",
    fileName: "test.jpg",
    path: "users/did_cheqd_test/uploads/test.jpg/123456789",
    uploadedAt: new Date().toISOString(),
    identityRef: "indexes/identities/hash1.json"
  });
  objects["indexes/alice/mnemonic-123456789.json"] = JSON.stringify({
    id: "123456789",
    fileName: "test.jpg",
    path: "public/alice/123456789",
    uploadedAt: new Date().toISOString(),
    identityRef: "indexes/identities/hash1.json"
  });
  
  return {
    BUCKET: "test-bucket",
    minioClient: {
      statObject: jest.fn(async (_bucket: string, key: string) => {
        if (objects[key]) return { size: 100, metaData: { "content-type": "image/jpeg" } };
        return Promise.reject(new Error("not found"));
      }),
      getObject: jest.fn(async (_bucket: string, key: string) => {
        if (!(key in objects)) throw new Error("not found");
        const { Readable } = await import("stream");
        const s = new Readable();
        s.push(Buffer.from(objects[key]));
        s.push(null);
        return s;
      }),
      putObject: jest.fn(async (_bucket: string, key: string, body: Buffer) => {
        objects[key] = body.toString();
        putCalls.push({ key });
        return {};
      }),
      presignedGetObject: jest.fn(async (_bucket: string, key: string) => `https://example.com/get/${encodeURIComponent(key)}`),
      presignedPutObject: jest.fn(async (_bucket: string, key: string) => `https://example.com/put/${encodeURIComponent(key)}`),
      listObjectsV2: jest.fn((_bucket: string, prefix: string) => {
        async function* gen() {
          for (const key of Object.keys(objects)) {
            if (key.startsWith(prefix)) {
              yield { name: key, etag: "e", size: 1, lastModified: new Date() } as any;
            }
          }
        }
        return gen();
      }),
      removeObjects: jest.fn(async (_bucket: string, keys: string[]) => {
        for (const k of keys) delete objects[k];
      }),
      removeObject: jest.fn(async (_bucket: string, key: string) => { delete objects[key]; }),
    },
    streamToBuffer: async (s: any) => {
      const chunks: Buffer[] = [];
      for await (const c of s) chunks.push(Buffer.from(c));
      return Buffer.concat(chunks);
    },
  };
});

describe("files routes (modular)", () => {
  let app: any;

  beforeAll(async () => {
    app = await createApp();
  });

  it("GET / should respond", async () => {
    const res = await request(app).get("/");
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/C2PA Modular Server/);
  });

  it("POST /files/request-upload-url should create identity and return presigned URL", async () => {
    const res = await request(app)
      .post("/files/request-upload-url")
      .send({
        userDID: "did:cheqd:test",
        contentHash: "hash1",
        softPerceptualHash: "s1",
        mediumPerceptualHash: "m1",
        precisePerceptualHash: "p1",
        name: "test.jpg"
      });
    expect(res.status).toBe(200);
    expect(res.body.fileId).toBeTruthy();
    expect(res.body.uploadUrl).toMatch(/^https:\/\/example.com/);
  });

  it("POST /files/check-file-uploaded should detect existing", async () => {
    // Use same contentHash as above
    const res = await request(app)
      .post("/files/check-file-uploaded")
      .send({ contentHash: "hash1", userDID: "did:cheqd:test" });
    expect(res.status).toBe(200);
    expect(res.body.existing).toBe(true);
  });

  it("POST /files/request-public-upload-url should return two presigned URLs", async () => {
    const res = await request(app)
      .post("/files/request-public-upload-url")
      .send({
        fileName: "pub.jpg",
        userDID: "did:cheqd:test",
        username: "alice",
        contentHash: "hash-pub",
        softPerceptualHash: "s2",
        mediumPerceptualHash: "m2",
        precisePerceptualHash: "p2",
      });
    expect(res.status).toBe(200);
    expect(res.body.fileId).toBeTruthy();
    expect(res.body.private_upload_url).toMatch(/^https:\/\/example.com/);
    expect(res.body.public_upload_url).toMatch(/^https:\/\/example.com/);
  });

  it("POST /files/publish-private-file should publish file to public", async () => {
    const res = await request(app)
      .post("/files/publish-private-file")
      .send({
        fileId: "123456789",
        mnemonicId: "test mnemonic",
        userDID: "did:cheqd:test",
        username: "alice",
        fileName: "test.jpg"
      });
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("File published successfully");
    expect(res.body.id).toBe("123456789");
    expect(res.body.publicUrl).toMatch(/^https:\/\/example.com/);
  });

  it("GET /files/list-user-files/:userDID should list user files", async () => {
    const res = await request(app).get("/files/list-user-files/did:cheqd:test");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("GET /files/list-public-files should list public files", async () => {
    const res = await request(app).get("/files/list-public-files");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /files/get-file-by-mnemonic should return file by mnemonic", async () => {
    const res = await request(app)
      .post("/files/get-file-by-mnemonic")
      .send({
        mnemonic: "test mnemonic",
        userDID: "did:cheqd:test"
      });
    expect(res.status).toBe(200);
    expect(res.body.fileId).toBeTruthy();
    expect(res.body.downloadUrl).toMatch(/^https:\/\/example.com/);
  });

  it("POST /files/get-public-file-by-mnemonic should return public file by mnemonic", async () => {
    const res = await request(app)
      .post("/files/get-public-file-by-mnemonic")
      .send({
        mnemonic: "test mnemonic",
        username: "alice"
      });
    expect(res.status).toBe(200);
    expect(res.body.fileId).toBeTruthy();
    expect(res.body.downloadUrl).toMatch(/^https:\/\/example.com/);
  });

  it("DELETE /files/delete-upload/:userDID/:fileId should delete upload", async () => {
    const res = await request(app).delete("/files/delete-upload/did:cheqd:test/123456789");
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Upload and related metadata deleted");
  });

  it("DELETE /files/delete-manifest/:userDID/:manifestId should delete manifest", async () => {
    const res = await request(app).delete("/files/delete-manifest/did:cheqd:test/manifest123");
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Manifest deleted successfully");
  });

  it("DELETE /files/delete-public-manifest/:username/:manifestId should delete public manifest", async () => {
    const res = await request(app).delete("/files/delete-public-manifest/alice/manifest123");
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Manifest deleted successfully");
  });

  it("GET /files/identity/:contentHash should return identity metadata", async () => {
    const res = await request(app).get("/files/identity/hash1");
    expect(res.status).toBe(200);
    expect(res.body.metadata).toBeTruthy();
  });
});
