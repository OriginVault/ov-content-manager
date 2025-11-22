import request from "supertest";
import { createApp } from "../../createApp.js";

// Mock MinIO methods used by routes
jest.mock("../../minio", () => ({
  minioClient: {
    bucketExists: jest.fn(async () => true),
  },
}));

describe("health routes (modular)", () => {
  let app: any;
  let minioClient: any;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(() => {
    minioClient = require("../../minio").minioClient;
    minioClient.bucketExists.mockResolvedValue(true);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("GET /health should return healthy status", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/C2PA Modular Server is healthy/);
    expect(res.body.status).toBe("healthy");
    expect(res.body.timestamp).toBeTruthy();
  });

  it("GET /health/detailed should return detailed health status", async () => {
    const res = await request(app).get("/health/detailed");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(res.body.services).toBeTruthy();
    expect(res.body.services.server).toBe("healthy");
    expect(res.body.services.minio).toBe("healthy");
    expect(res.body.timestamp).toBeTruthy();
  });

  it("GET /health/readiness should return ready status", async () => {
    const res = await request(app).get("/health/readiness");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.message).toBe("Service is ready to accept requests");
    expect(res.body.timestamp).toBeTruthy();
  });

  it("GET /health/liveness should return alive status", async () => {
    const res = await request(app).get("/health/liveness");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("alive");
    expect(res.body.message).toBe("Service is alive");
    expect(res.body.timestamp).toBeTruthy();
  });

  it("GET /health should handle MinIO connection failure", async () => {
    // Mock MinIO to throw an error
    minioClient.bucketExists.mockRejectedValueOnce(new Error("Connection failed"));

    const res = await request(app).get("/health");
    expect(res.status).toBe(500);
    expect(res.body.message).toMatch(/MinIO is not reachable/);
    expect(res.body.status).toBe("degraded");
    expect(res.body.timestamp).toBeTruthy();
  });

  it("GET /health/detailed should handle MinIO connection failure", async () => {
    // Mock MinIO to throw an error
    minioClient.bucketExists.mockRejectedValueOnce(new Error("Connection failed"));

    const res = await request(app).get("/health/detailed");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("degraded");
    expect(res.body.services.minio).toBe("unhealthy");
    expect(res.body.message).toBe("Some services are degraded");
  });

  it("GET /health/readiness should handle MinIO connection failure", async () => {
    // Mock MinIO to throw an error
    minioClient.bucketExists.mockRejectedValueOnce(new Error("Connection failed"));

    const res = await request(app).get("/health/readiness");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("not_ready");
    expect(res.body.error).toBe("Service is not ready");
  });
});
