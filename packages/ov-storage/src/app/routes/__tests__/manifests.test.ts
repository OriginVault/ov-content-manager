import request from "supertest";
import { createApp } from "../../createApp";

// Mock auth to always allow
jest.mock("../../auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => next(),
}));

// Mock MinIO methods used by routes
jest.mock("../../minio", () => {
  const putCalls: any[] = [];
  const objects: Record<string, any> = {};
  
  // Pre-populate with some test data
  objects["manifests/test-manifest.json"] = JSON.stringify({
    claim_generator: "ov-content-manager/1.0.0",
    format: "image/jpeg",
    title: "Test Manifest"
  });
  objects["public/manifests/public-manifest.json"] = JSON.stringify({
    claim_generator: "ov-content-manager/1.0.0",
    format: "image/png",
    title: "Public Manifest"
  });
  objects["users/did:cheqd:test/manifests/user-manifest.json"] = JSON.stringify({
    claim_generator: "ov-content-manager/1.0.0",
    format: "image/jpeg",
    title: "User Manifest"
  });
  // Add file metadata for C2PA signing test
  objects["users/did:cheqd:test/uploads/test-file-id"] = "test file content";
  objects["users/did:cheqd:test/file_metadata/test-file-id.json"] = JSON.stringify({
    fileId: "test-file-id",
    fileName: "test.jpg",
    userDID: "did:cheqd:test",
    uploadedAt: new Date().toISOString(),
    contentHash: "test-hash",
    size: 1024
  });
  // Add manifest entries for retrieval tests
  objects["manifests/test-manifest"] = JSON.stringify({
    claim_generator: "ov-content-manager/1.0.0",
    format: "image/jpeg",
    title: "Test Manifest"
  });
  objects["public/manifests/public-manifest"] = JSON.stringify({
    claim_generator: "ov-content-manager/1.0.0",
    format: "image/png",
    title: "Public Manifest"
  });
  
  return {
    BUCKET: "test-bucket",
    minioClient: {
      statObject: jest.fn(async (_bucket: string, key: string) => {
        if (objects[key]) return { size: 100, metaData: { "content-type": "application/json" } };
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

// Mock c2pa-node
jest.mock("c2pa-node", () => ({
  createC2pa: jest.fn(() => ({
    sign: jest.fn(async () => ({
      signedAsset: {
        buffer: Buffer.from("signed content"),
        mimeType: "image/jpeg"
      }
    }))
  })),
  createTestSigner: jest.fn(async () => ({})),
  ManifestBuilder: jest.fn().mockImplementation(() => ({
    asSendable: jest.fn(() => ({
      claim_generator: "ov-content-manager/1.0.0",
      format: "image/jpeg",
      title: "Test Manifest"
    }))
  })),
  // Add missing methods that might be used
  readManifest: jest.fn(async () => ({
    claim_generator: "ov-content-manager/1.0.0",
    format: "image/jpeg",
    title: "Test Manifest"
  }))
}));

// Mock fetch
global.fetch = jest.fn().mockImplementation((url: string, options?: any) => {
  // Handle PUT requests for file uploads
  if (options?.method === 'PUT') {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true }),
      text: () => Promise.resolve("OK"),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    });
  }
  
  // Handle GET requests (for file downloads)
  return Promise.resolve({
    ok: true,
    status: 200,
    body: {
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    },
    json: () => Promise.resolve({ success: true }),
    text: () => Promise.resolve("OK"),
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  });
});

describe("manifest routes (modular)", () => {
  let app: any;

  beforeAll(async () => {
    app = await createApp();
  });

  it("POST /manifests/sign should sign a file with C2PA", async () => {
    const res = await request(app)
      .post("/manifests/sign")
      .send({ fileId: "test-file-id" });
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("File signed successfully");
    expect(res.body.signedFileName).toBe("signed-test-file-id");
    expect(res.body.manifestFileName).toBe("manifests/test-file-id");
    expect(res.body.manifest).toBeTruthy();
  });

  it("POST /manifests/sign should return 400 for missing fileId", async () => {
    const res = await request(app)
      .post("/manifests/sign")
      .send({});
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing fileId");
  });

  it("POST /manifests/webhooks/signing-completed should process webhook", async () => {
    const webhookData = {
      fileId: "test-file-id",
      manifestId: "test-manifest-id",
      signatureStatus: "signed",
      attestationId: "test-attestation",
      blockchainRegistrationId: "test-registration",
      timestamp: new Date().toISOString()
    };

    const res = await request(app)
      .post("/manifests/webhooks/signing-completed")
      .set("X-Webhook-Signature", "test-signature")
      .send(webhookData);
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Webhook processed successfully");
  });

  it("POST /manifests/webhooks/signing-completed should reject webhook without signature", async () => {
    const webhookData = {
      fileId: "test-file-id",
      signatureStatus: "signed"
    };

    const res = await request(app)
      .post("/manifests/webhooks/signing-completed")
      .send(webhookData);
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing webhook signature");
  });

  it("GET /manifests/list-manifests should list all manifests", async () => {
    const res = await request(app).get("/manifests/list-manifests");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("name");
    expect(res.body[0]).toHaveProperty("previewUrl");
  });

  it("GET /manifests/list-public-manifests should list public manifests", async () => {
    const res = await request(app).get("/manifests/list-public-manifests");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("name");
    expect(res.body[0]).toHaveProperty("previewUrl");
  });

  it("GET /manifests/manifest/:manifestId should return manifest by ID", async () => {
    const res = await request(app).get("/manifests/manifest/test-manifest");
    expect(res.status).toBe(200);
    expect(res.body.manifest).toBeTruthy();
    expect(res.body.previewUrl).toMatch(/^https:\/\/example.com/);
  });

  it("GET /manifests/public-manifest/:manifestId should return public manifest by ID", async () => {
    const res = await request(app).get("/manifests/public-manifest/public-manifest");
    expect(res.status).toBe(200);
    expect(res.body.manifest).toBeTruthy();
    expect(res.body.previewUrl).toMatch(/^https:\/\/example.com/);
  });

  it("GET /manifests/list-user-manifests/:userDID should list user manifests", async () => {
    const res = await request(app).get("/manifests/list-user-manifests/did:cheqd:test");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("name");
    expect(res.body[0]).toHaveProperty("previewUrl");
  });

  it("GET /manifests/manifest/:manifestId should return 404 for non-existent manifest", async () => {
    const res = await request(app).get("/manifests/manifest/non-existent");
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Manifest not found");
  });
});
