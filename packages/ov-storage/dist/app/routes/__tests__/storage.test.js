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
const minio_1 = require("../../minio");
const cheqdStudio_1 = require("../../services/cheqdStudio");
// Mock MinIO client
jest.mock("../../minio", () => ({
    minioClient: {
        listObjects: jest.fn(),
        statObject: jest.fn(),
        presignedGetObject: jest.fn().mockResolvedValue("https://presigned-get-url.com"),
        presignedPutObject: jest.fn().mockResolvedValue("https://presigned-put-url.com"),
        presignedUrl: jest.fn().mockImplementation((method) => {
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
    requireAuth: (req, _res, next) => {
        req.auth = { sub: "test-user-123", mainDid: "did:cheqd:mainnet:user-main" };
        next();
    },
}));
describe("Storage Bucket APIs", () => {
    let app;
    let mockMinioClient;
    let mockCheqdStudioService;
    beforeEach(() => __awaiter(void 0, void 0, void 0, function* () {
        app = yield (0, createApp_1.createApp)();
        // Reset mocks
        jest.clearAllMocks();
        // Setup MinIO mock
        mockMinioClient = minio_1.minioClient;
        mockCheqdStudioService = cheqdStudio_1.cheqdStudioService;
    }));
    describe("Route mounting", () => {
        it("should mount storage routes correctly", () => __awaiter(void 0, void 0, void 0, function* () {
            // Test that the route exists by making a request
            const response = yield (0, supertest_1.default)(app)
                .get("/storage/b/test-did/objects")
                .set("Authorization", "Bearer test-token");
            // Should not get 404 (route not found)
            expect(response.status).not.toBe(404);
        }));
    });
    describe("GET /storage/b/:did/objects", () => {
        it("should mount storage routes correctly", () => __awaiter(void 0, void 0, void 0, function* () {
            // Test that the route exists by making a request
            const response = yield (0, supertest_1.default)(app)
                .get("/storage/b/test-did/objects")
                .set("Authorization", "Bearer test-token");
            // Should not get 404 (route not found)
            expect(response.status).not.toBe(404);
        }));
    });
});
