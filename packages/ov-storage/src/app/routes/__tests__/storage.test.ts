import request from "supertest";
import { createApp } from "../../createApp";
import { minioClient } from "../../minio";
import { cheqdStudioService } from "../../services/cheqdStudio";

// Mock MinIO client
jest.mock("../../minio", () => ({
  minioClient: {
    listObjects: jest.fn(),
    statObject: jest.fn(),
    presignedGetObject: jest.fn().mockResolvedValue("https://presigned-get-url.com"),
    presignedPutObject: jest.fn().mockResolvedValue("https://presigned-put-url.com"),
    presignedUrl: jest.fn().mockImplementation((method: string) => {
      if (method === "HEAD") {
        return Promise.resolve("https://presigned-head-url.com");
      }
      return Promise.resolve("https://presigned-url.com");
    }),
    removeObject: jest.fn().mockResolvedValue(undefined),
  },
}));

// Mock cheqd studio service
jest.mock("../../services/cheqdStudio", () => ({
  cheqdStudioService: {
    findUserStorageDid: jest.fn(),
  },
}));

// Mock auth to always allow
jest.mock("../../auth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.auth = { sub: "test-user-123", mainDid: "did:cheqd:mainnet:user-main" };
    next();
  },
}));

describe("Storage Bucket APIs", () => {
  let app: any;
  let mockMinioClient: any;
  let mockCheqdStudioService: any;

  beforeEach(async () => {
    app = await createApp();
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Setup MinIO mock
    mockMinioClient = (minioClient as any);
    mockCheqdStudioService = (cheqdStudioService as any);
  });

  describe("Route mounting", () => {
    it("should mount storage routes correctly", async () => {
      // Test that the route exists by making a request
      const response = await request(app)
        .get("/storage/b/test-did/objects")
        .set("Authorization", "Bearer test-token");

      // Should not get 404 (route not found)
      expect(response.status).not.toBe(404);
    });
  });

  describe("GET /storage/b/:did/objects", () => {
    it("should mount storage routes correctly", async () => {
      // Test that the route exists by making a request
      const response = await request(app)
        .get("/storage/b/test-did/objects")
        .set("Authorization", "Bearer test-token");

      // Should not get 404 (route not found)
      expect(response.status).not.toBe(404);
    });
  });
});
