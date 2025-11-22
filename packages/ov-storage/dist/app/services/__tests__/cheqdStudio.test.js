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
Object.defineProperty(exports, "__esModule", { value: true });
const cheqdStudio_1 = require("../cheqdStudio");
// Mock fetch
global.fetch = jest.fn();
describe("CheqdStudioService", () => {
    let service;
    let mockFetch;
    beforeEach(() => {
        service = new cheqdStudio_1.CheqdStudioService();
        mockFetch = global.fetch;
        jest.clearAllMocks();
    });
    describe("makeRequest", () => {
        it("should make successful API request", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockResponse = { did: "did:cheqd:mainnet:test", didDocument: {} };
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse),
            });
            const result = yield service.makeRequest("/test-endpoint");
            expect(mockFetch).toHaveBeenCalledWith("https://studio.cheqd.io/test-endpoint", expect.objectContaining({
                method: "GET",
                headers: expect.objectContaining({
                    "Content-Type": "application/json",
                }),
            }));
        }));
        it("should include authorization header when token is configured", () => __awaiter(void 0, void 0, void 0, function* () {
            process.env.CHEQD_STUDIO_TOKEN = "test-token";
            service = new cheqdStudio_1.CheqdStudioService();
            const mockResponse = { success: true };
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse),
            });
            yield service.makeRequest("/test-endpoint");
            expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
                headers: expect.objectContaining({
                    Authorization: "Bearer test-token",
                }),
            }));
            delete process.env.CHEQD_STUDIO_TOKEN;
        }));
        it("should handle API errors", () => __awaiter(void 0, void 0, void 0, function* () {
            mockFetch.mockResolvedValue({
                ok: false,
                status: 400,
                text: jest.fn().mockResolvedValue("Bad Request"),
            });
            yield expect(service.makeRequest("/test-endpoint")).rejects.toThrow("Cheqd Studio API error: 400 Bad Request");
        }));
    });
    describe("createStorageDid", () => {
        it("should create storage DID successfully", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockResponse = {
                did: "did:cheqd:mainnet:storage-123",
                didDocument: { id: "did:cheqd:mainnet:storage-123" },
            };
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse),
            });
            const result = yield service.createStorageDid();
            expect(result).toEqual(mockResponse);
            expect(mockFetch).toHaveBeenCalledWith("https://studio.cheqd.io/did/create/storage", expect.objectContaining({
                method: "POST",
                body: JSON.stringify({
                    type: "storage",
                    customerId: "",
                    network: "mainnet",
                }),
            }));
        }));
    });
    describe("createResource", () => {
        it("should create resource successfully", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockResponse = {
                resourceId: "resource-123",
                resourceUrl: "https://resolver.cheqd.io/resource-123",
            };
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse),
            });
            const request = {
                did: "did:cheqd:mainnet:test",
                resourceName: "test-resource",
                resourceType: "test-type",
                data: { test: "data" },
                version: "1.0.0",
            };
            const result = yield service.createResource(request);
            expect(result).toEqual(mockResponse);
            expect(mockFetch).toHaveBeenCalledWith("https://studio.cheqd.io/resources/create", expect.objectContaining({
                method: "POST",
                body: JSON.stringify(request),
            }));
        }));
    });
    describe("getResources", () => {
        it("should get resources with query parameters", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockResources = [
                {
                    id: "resource-1",
                    name: "test-resource",
                    type: "proof-of-upload",
                    version: "1.0.0",
                    data: { test: "data" },
                    createdAt: "2024-01-01T00:00:00Z",
                },
            ];
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResources),
            });
            const result = yield service.getResources({
                did: "did:cheqd:mainnet:test",
                resourceName: "test-resource",
                resourceType: "proof-of-upload",
                version: "1.0.0",
            });
            expect(result).toEqual(mockResources);
            expect(mockFetch).toHaveBeenCalledWith("https://studio.cheqd.io/resources/search/did:cheqd:mainnet:test?resourceName=test-resource&resourceType=proof-of-upload&version=1.0.0", expect.any(Object));
        }));
    });
    describe("createProofOfUpload", () => {
        it("should create Proof-of-Upload DLR", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockResponse = {
                resourceId: "pou-123",
                resourceUrl: "https://resolver.cheqd.io/pou-123",
            };
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResponse),
            });
            const result = yield service.createProofOfUpload("did:cheqd:mainnet:bucket", "snowflake-123", "mnemonic-abc", "hash-456", "test.jpg", 1024, "image/jpeg", "ip-hash-789", "manifest-ref", "manifest-mnemonic");
            expect(result).toEqual(mockResponse);
            expect(mockFetch).toHaveBeenCalledWith("https://studio.cheqd.io/resources/create", expect.objectContaining({
                method: "POST",
                body: expect.stringContaining("proof-of-upload"),
            }));
        }));
    });
    describe("ensureAnonymousBucketDid", () => {
        it("should return existing DID if found", () => __awaiter(void 0, void 0, void 0, function* () {
            const existingDid = "did:cheqd:mainnet:existing-bucket";
            const mockResources = [
                {
                    id: "resource-1",
                    name: "anonymous-bucket",
                    type: "originvault.bucket",
                    data: { did: existingDid },
                },
            ];
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResources),
            });
            process.env.ORIGINVAULT_STORAGE_DID = "did:cheqd:mainnet:originvault";
            const result = yield service.ensureAnonymousBucketDid();
            expect(result).toBe(existingDid);
            expect(mockFetch).toHaveBeenCalledWith("https://studio.cheqd.io/resources/search/did:cheqd:mainnet:originvault?resourceName=anonymous-bucket&resourceType=originvault.bucket", expect.any(Object));
            delete process.env.ORIGINVAULT_STORAGE_DID;
        }));
        it("should create new DID if not found", () => __awaiter(void 0, void 0, void 0, function* () {
            // First call returns empty resources (not found)
            mockFetch
                .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue([]),
            })
                // Second call returns new DID creation response
                .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    did: "did:cheqd:mainnet:new-bucket",
                    didDocument: {},
                }),
            })
                // Third call returns resource creation response
                .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue({
                    resourceId: "resource-123",
                    resourceUrl: "https://resolver.cheqd.io/resource-123",
                }),
            });
            process.env.ORIGINVAULT_STORAGE_DID = "did:cheqd:mainnet:originvault";
            const result = yield service.ensureAnonymousBucketDid();
            expect(result).toBe("did:cheqd:mainnet:new-bucket");
            expect(mockFetch).toHaveBeenCalledTimes(3);
            delete process.env.ORIGINVAULT_STORAGE_DID;
        }));
        it("should throw error if ORIGINVAULT_STORAGE_DID not configured", () => __awaiter(void 0, void 0, void 0, function* () {
            yield expect(service.ensureAnonymousBucketDid()).rejects.toThrow("ORIGINVAULT_STORAGE_DID not configured");
        }));
    });
    describe("createUserStorageDid", () => {
        it("should create user storage DID", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockDidResponse = {
                did: "did:cheqd:mainnet:user-storage",
                didDocument: {},
            };
            const mockResourceResponse = {
                resourceId: "resource-123",
                resourceUrl: "https://resolver.cheqd.io/resource-123",
            };
            mockFetch
                .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue(mockDidResponse),
            })
                .mockResolvedValueOnce({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResourceResponse),
            });
            process.env.ORIGINVAULT_STORAGE_DID = "did:cheqd:mainnet:originvault";
            const result = yield service.createUserStorageDid("user-123");
            expect(result).toBe("did:cheqd:mainnet:user-storage");
            expect(mockFetch).toHaveBeenCalledTimes(2);
            delete process.env.ORIGINVAULT_STORAGE_DID;
        }));
    });
    describe("findUserStorageDid", () => {
        it("should find existing user storage DID", () => __awaiter(void 0, void 0, void 0, function* () {
            const mockResources = [
                {
                    id: "resource-1",
                    name: "user-user123",
                    type: "originvault.user-storage",
                    data: { storageDid: "did:cheqd:mainnet:user-storage" },
                },
            ];
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue(mockResources),
            });
            process.env.ORIGINVAULT_STORAGE_DID = "did:cheqd:mainnet:originvault";
            const result = yield service.findUserStorageDid("user123");
            expect(result).toBe("did:cheqd:mainnet:user-storage");
            delete process.env.ORIGINVAULT_STORAGE_DID;
        }));
        it("should return null if user storage DID not found", () => __awaiter(void 0, void 0, void 0, function* () {
            mockFetch.mockResolvedValue({
                ok: true,
                json: jest.fn().mockResolvedValue([]),
            });
            process.env.ORIGINVAULT_STORAGE_DID = "did:cheqd:mainnet:originvault";
            const result = yield service.findUserStorageDid("user123");
            expect(result).toBeNull();
            delete process.env.ORIGINVAULT_STORAGE_DID;
        }));
    });
});
