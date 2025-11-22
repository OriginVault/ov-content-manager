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
const createApp_1 = require("../../createApp");
// Mock MinIO methods used by routes
jest.mock("../../minio", () => ({
    minioClient: {
        bucketExists: jest.fn(() => __awaiter(void 0, void 0, void 0, function* () { return true; })),
    },
}));
describe("health routes (modular)", () => {
    let app;
    let minioClient;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        app = yield (0, createApp_1.createApp)();
    }));
    beforeEach(() => {
        minioClient = require("../../minio").minioClient;
        minioClient.bucketExists.mockResolvedValue(true);
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it("GET /health should return healthy status", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/C2PA Modular Server is healthy/);
        expect(res.body.status).toBe("healthy");
        expect(res.body.timestamp).toBeTruthy();
    }));
    it("GET /health/detailed should return detailed health status", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/health/detailed");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("healthy");
        expect(res.body.services).toBeTruthy();
        expect(res.body.services.server).toBe("healthy");
        expect(res.body.services.minio).toBe("healthy");
        expect(res.body.timestamp).toBeTruthy();
    }));
    it("GET /health/readiness should return ready status", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/health/readiness");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ready");
        expect(res.body.message).toBe("Service is ready to accept requests");
        expect(res.body.timestamp).toBeTruthy();
    }));
    it("GET /health/liveness should return alive status", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/health/liveness");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("alive");
        expect(res.body.message).toBe("Service is alive");
        expect(res.body.timestamp).toBeTruthy();
    }));
    it("GET /health should handle MinIO connection failure", () => __awaiter(void 0, void 0, void 0, function* () {
        // Mock MinIO to throw an error
        minioClient.bucketExists.mockRejectedValueOnce(new Error("Connection failed"));
        const res = yield (0, supertest_1.default)(app).get("/health");
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/MinIO is not reachable/);
        expect(res.body.status).toBe("degraded");
        expect(res.body.timestamp).toBeTruthy();
    }));
    it("GET /health/detailed should handle MinIO connection failure", () => __awaiter(void 0, void 0, void 0, function* () {
        // Mock MinIO to throw an error
        minioClient.bucketExists.mockRejectedValueOnce(new Error("Connection failed"));
        const res = yield (0, supertest_1.default)(app).get("/health/detailed");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("degraded");
        expect(res.body.services.minio).toBe("unhealthy");
        expect(res.body.message).toBe("Some services are degraded");
    }));
    it("GET /health/readiness should handle MinIO connection failure", () => __awaiter(void 0, void 0, void 0, function* () {
        // Mock MinIO to throw an error
        minioClient.bucketExists.mockRejectedValueOnce(new Error("Connection failed"));
        const res = yield (0, supertest_1.default)(app).get("/health/readiness");
        expect(res.status).toBe(503);
        expect(res.body.status).toBe("not_ready");
        expect(res.body.error).toBe("Service is not ready");
    }));
});
