import request from "supertest";
import { createApp } from "../../createApp.js";

// Mock auth to always allow
jest.mock("../../auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => next(),
}));

// Mock MinIO methods used by routes
jest.mock("../../minio", () => {
  const buckets = ["test-bucket", "another-bucket"];
  const objects: Record<string, any[]> = {
    "test-bucket": [
      { name: "file1.jpg", size: 2097152, lastModified: new Date(), etag: "etag1" }, // 2MB
      { name: "file2.png", size: 3145728, lastModified: new Date(), etag: "etag2" }  // 3MB
    ]
  };
  
  return {
    minioClient: {
      makeBucket: jest.fn(async (bucketName: string) => {
        buckets.push(bucketName);
        return {};
      }),
      bucketExists: jest.fn(async (bucketName: string) => {
        return buckets.includes(bucketName);
      }),
      listBuckets: jest.fn(async () => {
        return buckets.map(name => ({ name }));
      }),
      listObjects: jest.fn(async (bucketName: string) => {
        return objects[bucketName] || [];
      }),
      listObjectsV2: jest.fn((bucketName: string) => {
        async function* gen() {
          const bucketObjects = objects[bucketName] || [];
          for (const obj of bucketObjects) {
            yield obj;
          }
        }
        return gen();
      }),
      presignedGetObject: jest.fn(async (bucket: string, key: string) => `https://example.com/get/${bucket}/${key}`),
      statObject: jest.fn(async (bucket: string, key: string) => ({
        size: 2097152, // 2MB
        lastModified: new Date(),
        etag: "test-etag",
        metaData: { "content-type": "image/jpeg" }
      })),
      copyObject: jest.fn(async (destBucket: string, destObject: string, source: string) => {
        return {};
      }),
      removeObjects: jest.fn(async (bucketName: string, objectNames: string[]) => {
        if (objects[bucketName]) {
          objects[bucketName] = objects[bucketName].filter(obj => !objectNames.includes(obj.name));
        }
        return {};
      }),
      removeBucket: jest.fn(async (bucketName: string) => {
        const index = buckets.indexOf(bucketName);
        if (index > -1) {
          buckets.splice(index, 1);
        }
        return {};
      }),
    },
    streamToBuffer: async (s: any) => {
      const chunks: Buffer[] = [];
      for await (const c of s) chunks.push(Buffer.from(c));
      return Buffer.concat(chunks);
    },
  };
});

describe("bucket routes (modular)", () => {
  let app: any;

  beforeAll(async () => {
    app = await createApp();
  });

  it("POST /buckets/create_bucket should create a new bucket", async () => {
    const res = await request(app)
      .post("/buckets/create_bucket")
      .send({ bucketName: "new-test-bucket" });
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Bucket new-test-bucket created successfully");
  });

  it("POST /buckets/create_bucket should return 400 for missing bucketName", async () => {
    const res = await request(app)
      .post("/buckets/create_bucket")
      .send({});
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing bucketName");
  });

  it("GET /buckets/bucket_exists should check if bucket exists", async () => {
    const res = await request(app)
      .get("/buckets/bucket_exists?bucketName=test-bucket");
    
    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.bucketName).toBe("test-bucket");
  });

  it("GET /buckets/bucket_exists should return 400 for missing bucketName", async () => {
    const res = await request(app).get("/buckets/bucket_exists");
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing bucketName query parameter");
  });

  it("GET /buckets/list_buckets should list all buckets", async () => {
    const res = await request(app).get("/buckets/list_buckets");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("name");
  });

  it("GET /buckets/list_files/:bucketName should list files in bucket", async () => {
    const res = await request(app).get("/buckets/list_files/test-bucket");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0]).toHaveProperty("name");
    expect(res.body[0]).toHaveProperty("size");
  });

  it("GET /buckets/list_files/:bucketName should handle prefix and recursive params", async () => {
    const res = await request(app)
      .get("/buckets/list_files/test-bucket?prefix=file&recursive=false");
    
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("POST /buckets/request-download-url should return presigned URL", async () => {
    const res = await request(app)
      .post("/buckets/request-download-url")
      .send({ fileName: "test-file.jpg" });
    
    expect(res.status).toBe(200);
    expect(res.body.downloadUrl).toMatch(/^https:\/\/example.com/);
  });

  it("POST /buckets/request-download-url should return 400 for missing fileName", async () => {
    const res = await request(app)
      .post("/buckets/request-download-url")
      .send({});
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing fileName");
  });

  it("GET /buckets/bucket_stats/:bucketName should return bucket statistics", async () => {
    const res = await request(app).get("/buckets/bucket_stats/test-bucket");
    
    expect(res.status).toBe(200);
    expect(res.body.bucketName).toBe("test-bucket");
    expect(res.body.objectCount).toBeGreaterThan(0);
    expect(res.body.totalSize).toBeGreaterThan(0);
    expect(res.body.totalSizeMB).toBeGreaterThan(0);
    expect(res.body.fileTypes).toBeTruthy();
  });

  it("DELETE /buckets/delete_bucket/:bucketName should delete bucket", async () => {
    const res = await request(app).delete("/buckets/delete_bucket/test-bucket");
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Bucket test-bucket deleted successfully");
  });

  it("GET /buckets/object_metadata/:bucketName/* should return object metadata", async () => {
    const res = await request(app).get("/buckets/object_metadata/test-bucket/test-file.jpg");
    
    expect(res.status).toBe(200);
    expect(res.body.bucketName).toBe("test-bucket");
    expect(res.body.objectName).toBe("test-file.jpg");
    expect(res.body.size).toBe(2097152);
    expect(res.body.contentType).toBe("image/jpeg");
    expect(res.body.metadata).toBeTruthy();
  });

  it("POST /buckets/copy_object should copy object", async () => {
    const res = await request(app)
      .post("/buckets/copy_object")
      .send({
        sourceBucket: "source-bucket",
        sourceObject: "source-file.jpg",
        destBucket: "dest-bucket",
        destObject: "dest-file.jpg"
      });
    
    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Object copied successfully");
    expect(res.body.source).toBe("source-bucket/source-file.jpg");
    expect(res.body.destination).toBe("dest-bucket/dest-file.jpg");
  });

  it("POST /buckets/copy_object should return 400 for missing parameters", async () => {
    const res = await request(app)
      .post("/buckets/copy_object")
      .send({
        sourceBucket: "source-bucket"
        // Missing other required parameters
      });
    
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Missing required parameters");
  });
});
