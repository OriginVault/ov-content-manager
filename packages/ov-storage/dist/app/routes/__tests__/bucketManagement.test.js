"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const express_1 = __importDefault(require("express"));
const bucketManagement_1 = require("../bucketManagement");
const bucketService_1 = require("../../services/bucketService");
const c2paService_1 = require("../../services/c2paService");
// Mock the services
jest.mock("../../services/bucketService");
jest.mock("../../services/c2paService");
jest.mock("../../auth", () => ({
    requireAuth: (req, res, next) => {
        req.auth = { sub: "test-user-id", mainDid: "did:cheqd:test:storage-did" };
        next();
    }
}));
const app = (0, express_1.default)();
app.use(express_1.default.json());
app.use("/bucket", bucketManagement_1.bucketManagementRoutes);
describe("Bucket Management Routes", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });
    describe("GET /bucket/quota", () => {
        it("should return quota information for authenticated user", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockQuotaInfo = {
                userId: "test-user-id",
                storageDid: "did:cheqd:test:storage-did",
                currentUsage: 1024 * 1024 * 1024, // 1GB
                maxQuota: 10 * 1024 * 1024 * 1024, // 10GB
                usagePercentage: 10,
                isOverQuota: false,
                files: [
                    {
                        key: "users/test-user-id/file1.jpg",
                        size: 1024 * 1024 * 1024,
                        lastModified: new Date(),
                        mimeType: "image/jpeg"
                    }
                ]
            };
            bucketService_1.BucketService.prototype.getQuotaInfo =
                jest.fn().mockResolvedValue(mockQuotaInfo);
            const response = yield (0, supertest_1.default)(app)
                .get("/bucket/quota")
                .expect(200);
            expect(response.body.success).toBe(true);
            expect(response.body.quota.userId).toBe("test-user-id");
            expect(response.body.quota.storageDid).toBe("did:cheqd:test:storage-did");
            expect(response.body.quota.currentUsage).toBe(1024 * 1024 * 1024);
            expect(response.body.quota.maxQuota).toBe(10 * 1024 * 1024 * 1024);
            expect(response.body.quota.usagePercentage).toBe(10);
            expect(response.body.quota.isOverQuota).toBe(false);
            expect(response.body.quota.formattedUsage).toBe("1 GB");
            expect(response.body.quota.formattedMaxQuota).toBe("10 GB");
            expect(response.body.files).toHaveLength(1);
        }));
        it("should handle quota service errors", () => __awaiter(void 0, void 0, void 0, function* () {
            bucketService_1.BucketService.prototype.getQuotaInfo =
                jest.fn().mockRejectedValue(new Error("Service error"));
            const response = yield (0, supertest_1.default)(app)
                .get("/bucket/quota")
                .expect(500);
            expect(response.body.error).toBe("Failed to get quota information");
            expect(response.body.details).toBe("Service error");
        }));
    });
    describe("GET /bucket/stats", () => {
        it("should return bucket statistics for authenticated user", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockStats = {
                totalSize: 2048 * 1024 * 1024, // 2GB
                fileCount: 5,
                fileTypes: { jpg: 3, png: 2 },
                lastUpdated: new Date()
            };
            bucketService_1.BucketService.prototype.getBucketStats =
                jest.fn().mockResolvedValue(mockStats);
            const response = yield (0, supertest_1.default)(app)
                .get("/bucket/stats")
                .expect(200);
            expect(response.body.success).toBe(true);
            expect(response.body.stats.totalSize).toBe(2048 * 1024 * 1024);
            expect(response.body.stats.fileCount).toBe(5);
            expect(response.body.stats.formattedTotalSize).toBe("2 GB");
            expect(response.body.stats.formattedFileTypes).toEqual([
                { extension: "jpg", count: 3, percentage: "60.0" },
                { extension: "png", count: 2, percentage: "40.0" }
            ]);
        }));
        it("should handle stats service errors", () => __awaiter(void 0, void 0, void 0, function* () {
            bucketService_1.BucketService.prototype.getBucketStats =
                jest.fn().mockRejectedValue(new Error("Stats error"));
            const response = yield (0, supertest_1.default)(app)
                .get("/bucket/stats")
                .expect(500);
            expect(response.body.error).toBe("Failed to get bucket statistics");
            expect(response.body.details).toBe("Stats error");
        }));
    });
    describe("POST /bucket/cleanup", () => {
        it("should cleanup old files successfully", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockCleanupResult = {
                removedFiles: 3,
                freedSpace: 512 * 1024 * 1024 // 512MB
            };
            bucketService_1.BucketService.prototype.cleanupOldFiles =
                jest.fn().mockResolvedValue(mockCleanupResult);
            const response = yield (0, supertest_1.default)(app)
                .post("/bucket/cleanup")
                .send({ targetSizeGB: 8, keepRecentHours: 24 })
                .expect(200);
            expect(response.body.success).toBe(true);
            expect(response.body.cleanup.removedFiles).toBe(3);
            expect(response.body.cleanup.freedSpace).toBe(512 * 1024 * 1024);
            expect(response.body.cleanup.formattedFreedSpace).toBe("512 MB");
            expect(response.body.cleanup.targetSize).toBe(8 * 1024 * 1024 * 1024);
            expect(response.body.cleanup.formattedTargetSize).toBe("8 GB");
            expect(response.body.cleanup.keepRecentHours).toBe(24);
        }));
        it("should use default values when not provided", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockCleanupResult = {
                removedFiles: 0,
                freedSpace: 0
            };
            bucketService_1.BucketService.prototype.cleanupOldFiles =
                jest.fn().mockResolvedValue(mockCleanupResult);
            const response = yield (0, supertest_1.default)(app)
                .post("/bucket/cleanup")
                .send({})
                .expect(200);
            expect(response.body.success).toBe(true);
            expect(response.body.cleanup.keepRecentHours).toBe(24);
        }));
        it("should handle cleanup service errors", () => __awaiter(void 0, void 0, void 0, function* () {
            bucketService_1.BucketService.prototype.cleanupOldFiles =
                jest.fn().mockRejectedValue(new Error("Cleanup error"));
            const response = yield (0, supertest_1.default)(app)
                .post("/bucket/cleanup")
                .send({ targetSizeGB: 8 })
                .expect(500);
            expect(response.body.error).toBe("Failed to cleanup old files");
            expect(response.body.details).toBe("Cleanup error");
        }));
    });
    describe("GET /bucket/supported-types", () => {
        it("should return categorized supported file types", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockSupportedTypes = [
                "image/jpeg", "image/png", "image/gif",
                "video/mp4", "video/quicktime",
                "audio/mpeg", "audio/wav",
                "application/pdf", "text/plain"
            ];
            c2paService_1.c2paService.getSupportedTypes =
                jest.fn().mockReturnValue(mockSupportedTypes);
            const response = yield (0, supertest_1.default)(app)
                .get("/bucket/supported-types")
                .expect(200);
            expect(response.body.success).toBe(true);
            expect(response.body.totalTypes).toBe(8);
            expect(response.body.categories).toContain("images");
            expect(response.body.categories).toContain("videos");
            expect(response.body.categories).toContain("audio");
            expect(response.body.categories).toContain("documents");
            expect(response.body.supportedTypes.images).toContain("image/jpeg");
            expect(response.body.supportedTypes.videos).toContain("video/mp4");
            expect(response.body.supportedTypes.audio).toContain("audio/mpeg");
            expect(response.body.supportedTypes.documents).toContain("application/pdf");
        }));
        it("should handle service errors", () => __awaiter(void 0, void 0, void 0, function* () {
            c2paService_1.c2paService.getSupportedTypes =
                jest.fn().mockImplementation(() => {
                    throw new Error("Service error");
                });
            const response = yield (0, supertest_1.default)(app)
                .get("/bucket/supported-types")
                .expect(500);
            expect(response.body.error).toBe("Failed to get supported file types");
            expect(response.body.details).toBe("Service error");
        }));
    });
    describe("GET /bucket/check-type/:mimeType", () => {
        it("should return support status for supported file type", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockFileTypeInfo = { format: "image/jpeg", extension: "jpg" };
            c2paService_1.c2paService.isSupported =
                jest.fn().mockReturnValue(true);
            c2paService_1.c2paService.getFileTypeInfo =
                jest.fn().mockReturnValue(mockFileTypeInfo);
            c2paService_1.c2paService.getFileCategory =
                jest.fn().mockReturnValue("image");
            const response = yield (0, supertest_1.default)(app)
                .get("/bucket/check-type/image/jpeg")
                .expect(200);
            expect(response.body.success).toBe(true);
            expect(response.body.mimeType).toBe("image/jpeg");
            expect(response.body.isSupported).toBe(true);
            expect(response.body.fileTypeInfo).toEqual(mockFileTypeInfo);
            expect(response.body.category).toBe("image");
        }));
        it("should return support status for unsupported file type", () => __awaiter(void 0, void 0, void 0, function* () {
            c2paService_1.c2paService.isSupported =
                jest.fn().mockReturnValue(false);
            c2paService_1.c2paService.getFileTypeInfo =
                jest.fn().mockReturnValue(null);
            const response = yield (0, supertest_1.default)(app)
                .get("/bucket/check-type/application/unsupported")
                .expect(200);
            expect(response.body.success).toBe(true);
            expect(response.body.mimeType).toBe("application/unsupported");
            expect(response.body.isSupported).toBe(false);
            expect(response.body.fileTypeInfo).toBeNull();
            expect(response.body.category).toBeNull();
        }));
        it("should handle service errors", () => __awaiter(void 0, void 0, void 0, function* () {
            c2paService_1.c2paService.isSupported =
                jest.fn().mockImplementation(() => {
                    throw new Error("Service error");
                });
            const response = yield (0, supertest_1.default)(app)
                .get("/bucket/check-type/image/jpeg")
                .expect(500);
            expect(response.body.error).toBe("Failed to check file type support");
            expect(response.body.details).toBe("Service error");
        }));
    });
    describe("POST /bucket/clear-cache", () => {
        it("should clear cache successfully", () => __awaiter(void 0, void 0, void 0, function* () {
            bucketService_1.BucketService.prototype.clearCache =
                jest.fn().mockImplementation(() => { });
            const response = yield (0, supertest_1.default)(app)
                .post("/bucket/clear-cache")
                .expect(200);
            expect(response.body.success).toBe(true);
            expect(response.body.message).toBe("Cache cleared successfully");
            expect(response.body.userId).toBe("test-user-id");
            expect(response.body.storageDid).toBe("did:cheqd:test:storage-did");
        }));
        it("should handle cache clearing errors", () => __awaiter(void 0, void 0, void 0, function* () {
            bucketService_1.BucketService.prototype.clearCache =
                jest.fn().mockImplementation(() => {
                    throw new Error("Cache error");
                });
            const response = yield (0, supertest_1.default)(app)
                .post("/bucket/clear-cache")
                .expect(500);
            expect(response.body.error).toBe("Failed to clear cache");
            expect(response.body.details).toBe("Cache error");
        }));
    });
});
