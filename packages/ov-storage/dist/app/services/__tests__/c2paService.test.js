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
const c2paService_1 = require("../c2paService");
// Mock c2pa-node
jest.mock("c2pa-node", () => ({
    createC2pa: jest.fn(() => ({
        sign: jest.fn(),
        read: jest.fn()
    })),
    createTestSigner: jest.fn(() => ({})),
    ManifestBuilder: jest.fn().mockImplementation((options) => (Object.assign(Object.assign({}, options), { addAction: jest.fn(), addThumbnail: jest.fn() })))
}));
// Mock logger
jest.mock("../../../logger", () => ({
    __esModule: true,
    default: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));
describe("C2PA Service", () => {
    let c2paService;
    beforeEach(() => {
        c2paService = new c2paService_1.C2PAService();
    });
    describe("File Type Support", () => {
        it("should support common image formats", () => {
            expect(c2paService.isSupported("image/jpeg")).toBe(true);
            expect(c2paService.isSupported("image/png")).toBe(true);
            expect(c2paService.isSupported("image/gif")).toBe(true);
            expect(c2paService.isSupported("image/webp")).toBe(true);
            expect(c2paService.isSupported("image/tiff")).toBe(true);
            expect(c2paService.isSupported("image/bmp")).toBe(true);
            expect(c2paService.isSupported("image/heic")).toBe(true);
            expect(c2paService.isSupported("image/avif")).toBe(true);
        });
        it("should support common video formats", () => {
            expect(c2paService.isSupported("video/mp4")).toBe(true);
            expect(c2paService.isSupported("video/quicktime")).toBe(true);
            expect(c2paService.isSupported("video/x-msvideo")).toBe(true);
            expect(c2paService.isSupported("video/webm")).toBe(true);
            expect(c2paService.isSupported("video/ogg")).toBe(true);
            expect(c2paService.isSupported("video/mpeg")).toBe(true);
            expect(c2paService.isSupported("video/x-matroska")).toBe(true);
        });
        it("should support common audio formats", () => {
            expect(c2paService.isSupported("audio/mpeg")).toBe(true);
            expect(c2paService.isSupported("audio/wav")).toBe(true);
            expect(c2paService.isSupported("audio/ogg")).toBe(true);
            expect(c2paService.isSupported("audio/flac")).toBe(true);
            expect(c2paService.isSupported("audio/aac")).toBe(true);
            expect(c2paService.isSupported("audio/m4a")).toBe(true);
            expect(c2paService.isSupported("audio/webm")).toBe(true);
        });
        it("should support document formats", () => {
            expect(c2paService.isSupported("application/pdf")).toBe(true);
            expect(c2paService.isSupported("application/msword")).toBe(true);
            expect(c2paService.isSupported("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(true);
            expect(c2paService.isSupported("application/vnd.ms-excel")).toBe(true);
            expect(c2paService.isSupported("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe(true);
            expect(c2paService.isSupported("application/vnd.ms-powerpoint")).toBe(true);
            expect(c2paService.isSupported("application/vnd.openxmlformats-officedocument.presentationml.presentation")).toBe(true);
        });
        it("should support 3D model formats", () => {
            expect(c2paService.isSupported("model/gltf+json")).toBe(true);
            expect(c2paService.isSupported("model/gltf-binary")).toBe(true);
            expect(c2paService.isSupported("model/obj")).toBe(true);
            expect(c2paService.isSupported("model/stl")).toBe(true);
            expect(c2paService.isSupported("model/fbx")).toBe(true);
            expect(c2paService.isSupported("model/3ds")).toBe(true);
        });
        it("should support archive formats", () => {
            expect(c2paService.isSupported("application/zip")).toBe(true);
            expect(c2paService.isSupported("application/x-rar-compressed")).toBe(true);
            expect(c2paService.isSupported("application/x-7z-compressed")).toBe(true);
            expect(c2paService.isSupported("application/gzip")).toBe(true);
            expect(c2paService.isSupported("application/x-tar")).toBe(true);
        });
        it("should support text formats", () => {
            expect(c2paService.isSupported("text/plain")).toBe(true);
            expect(c2paService.isSupported("text/html")).toBe(true);
            expect(c2paService.isSupported("text/css")).toBe(true);
            expect(c2paService.isSupported("text/javascript")).toBe(true);
            expect(c2paService.isSupported("application/json")).toBe(true);
            expect(c2paService.isSupported("application/xml")).toBe(true);
            expect(c2paService.isSupported("text/markdown")).toBe(true);
        });
        it("should support font formats", () => {
            expect(c2paService.isSupported("font/woff")).toBe(true);
            expect(c2paService.isSupported("font/woff2")).toBe(true);
            expect(c2paService.isSupported("font/ttf")).toBe(true);
            expect(c2paService.isSupported("font/otf")).toBe(true);
        });
        it("should support vector graphics", () => {
            expect(c2paService.isSupported("image/svg+xml")).toBe(true);
            expect(c2paService.isSupported("application/postscript")).toBe(true);
            expect(c2paService.isSupported("application/eps")).toBe(true);
            expect(c2paService.isSupported("application/ai")).toBe(true);
        });
        it("should support raw image formats", () => {
            expect(c2paService.isSupported("image/x-raw")).toBe(true);
            expect(c2paService.isSupported("image/x-adobe-dng")).toBe(true);
            expect(c2paService.isSupported("image/x-canon-cr2")).toBe(true);
            expect(c2paService.isSupported("image/x-nikon-nef")).toBe(true);
            expect(c2paService.isSupported("image/x-sony-arw")).toBe(true);
        });
        it("should not support unsupported formats", () => {
            expect(c2paService.isSupported("application/unsupported")).toBe(false);
            expect(c2paService.isSupported("text/unsupported")).toBe(false);
            expect(c2paService.isSupported("video/unsupported")).toBe(false);
            expect(c2paService.isSupported("audio/unsupported")).toBe(false);
        });
    });
    describe("getSupportedTypes", () => {
        it("should return all supported types", () => {
            const supportedTypes = c2paService.getSupportedTypes();
            expect(supportedTypes).toHaveLength(Object.keys(c2paService_1.C2PA_SUPPORTED_TYPES).length);
            expect(supportedTypes).toContain("image/jpeg");
            expect(supportedTypes).toContain("video/mp4");
            expect(supportedTypes).toContain("audio/mpeg");
            expect(supportedTypes).toContain("application/pdf");
        });
    });
    describe("getFileTypeInfo", () => {
        it("should return correct file type info for supported types", () => {
            const jpegInfo = c2paService.getFileTypeInfo("image/jpeg");
            expect(jpegInfo).toEqual({ format: "image/jpeg", extension: "jpg" });
            const pngInfo = c2paService.getFileTypeInfo("image/png");
            expect(pngInfo).toEqual({ format: "image/png", extension: "png" });
            const mp4Info = c2paService.getFileTypeInfo("video/mp4");
            expect(mp4Info).toEqual({ format: "video/mp4", extension: "mp4" });
            const pdfInfo = c2paService.getFileTypeInfo("application/pdf");
            expect(pdfInfo).toEqual({ format: "application/pdf", extension: "pdf" });
        });
        it("should return null for unsupported types", () => {
            const unsupportedInfo = c2paService.getFileTypeInfo("application/unsupported");
            expect(unsupportedInfo).toBeNull();
        });
    });
    describe("generateManifest", () => {
        const mockFileBuffer = Buffer.from("test file content");
        const mockOptions = {
            title: "Test Upload",
            userId: "test-user",
            fileName: "test.jpg",
            fileSize: 1024,
            mimeType: "image/jpeg",
            contentHash: "abc123",
            snowflake: "123456789",
            mnemonicId: "test-mnemonic",
            uploadTime: new Date(),
            isAnonymous: false
        };
        it("should generate manifest for supported file type", () => __awaiter(void 0, void 0, void 0, function* () {
            const result = yield c2paService.generateManifest(mockFileBuffer, mockOptions);
            expect(result.success).toBe(true);
            expect(result.manifest).toBeDefined();
            expect(result.manifestKey).toBe("users/test-user/test-mnemonic/manifest.json");
            expect(result.manifestMnemonicId).toBe("test-mnemonic");
            expect(result.error).toBeUndefined();
        }));
        it("should generate manifest for anonymous upload", () => __awaiter(void 0, void 0, void 0, function* () {
            const anonymousOptions = Object.assign(Object.assign({}, mockOptions), { isAnonymous: true, clientIp: "192.168.1.1" });
            const result = yield c2paService.generateManifest(mockFileBuffer, anonymousOptions);
            expect(result.success).toBe(true);
            expect(result.manifest).toBeDefined();
            expect(result.manifestKey).toBe("anonymous/manifests/test-mnemonic/manifest.json");
            expect(result.manifestMnemonicId).toBe("test-mnemonic");
        }));
        it("should fail for unsupported file type", () => __awaiter(void 0, void 0, void 0, function* () {
            const unsupportedOptions = Object.assign(Object.assign({}, mockOptions), { mimeType: "application/unsupported" });
            const result = yield c2paService.generateManifest(mockFileBuffer, unsupportedOptions);
            expect(result.success).toBe(false);
            expect(result.error).toBe("File type application/unsupported is not supported for C2PA manifest generation");
            expect(result.manifest).toBeUndefined();
            expect(result.manifestKey).toBeUndefined();
        }));
        it("should handle errors during manifest generation", () => __awaiter(void 0, void 0, void 0, function* () {
            // Mock ManifestBuilder to throw an error
            const { ManifestBuilder } = require("c2pa-node");
            ManifestBuilder.mockImplementation(() => {
                throw new Error("Manifest creation failed");
            });
            const result = yield c2paService.generateManifest(mockFileBuffer, mockOptions);
            expect(result.success).toBe(false);
            expect(result.error).toBe("Manifest creation failed");
        }));
    });
    describe("File Categories", () => {
        it("should correctly categorize image files", () => {
            expect(c2paService.getFileCategory("image/jpeg")).toBe("image");
            expect(c2paService.getFileCategory("image/png")).toBe("image");
            expect(c2paService.getFileCategory("image/gif")).toBe("image");
            expect(c2paService.getFileCategory("image/svg+xml")).toBe("image");
        });
        it("should correctly categorize video files", () => {
            expect(c2paService.getFileCategory("video/mp4")).toBe("video");
            expect(c2paService.getFileCategory("video/quicktime")).toBe("video");
            expect(c2paService.getFileCategory("video/webm")).toBe("video");
        });
        it("should correctly categorize audio files", () => {
            expect(c2paService.getFileCategory("audio/mpeg")).toBe("audio");
            expect(c2paService.getFileCategory("audio/wav")).toBe("audio");
            expect(c2paService.getFileCategory("audio/flac")).toBe("audio");
        });
        it("should correctly categorize 3D model files", () => {
            expect(c2paService.getFileCategory("model/gltf+json")).toBe("3d");
            expect(c2paService.getFileCategory("model/obj")).toBe("3d");
            expect(c2paService.getFileCategory("model/stl")).toBe("3d");
        });
        it("should correctly categorize document files", () => {
            expect(c2paService.getFileCategory("application/pdf")).toBe("document");
            expect(c2paService.getFileCategory("text/plain")).toBe("document");
            expect(c2paService.getFileCategory("application/json")).toBe("document");
        });
        it("should correctly categorize font files", () => {
            expect(c2paService.getFileCategory("font/woff")).toBe("font");
            expect(c2paService.getFileCategory("font/ttf")).toBe("font");
            expect(c2paService.getFileCategory("font/otf")).toBe("font");
        });
        it("should categorize unknown types as other", () => {
            expect(c2paService.getFileCategory("application/unknown")).toBe("other");
            expect(c2paService.getFileCategory("text/unknown")).toBe("other");
        });
    });
    describe("signFile", () => {
        const mockFileBuffer = Buffer.from("test file content");
        const mockManifest = { title: "Test Manifest" };
        it("should sign file successfully", () => __awaiter(void 0, void 0, void 0, function* () {
            const { createC2pa } = require("c2pa-node");
            const mockC2pa = {
                sign: jest.fn().mockResolvedValue({
                    signedAsset: { buffer: Buffer.from("signed content") }
                })
            };
            createC2pa.mockReturnValue(mockC2pa);
            // Create a new instance to use the mocked c2pa
            const testC2paService = new c2paService_1.C2PAService();
            const result = yield testC2paService.signFile(mockFileBuffer, "image/jpeg", mockManifest);
            expect(result).toEqual(Buffer.from("signed content"));
            expect(mockC2pa.sign).toHaveBeenCalledWith({
                asset: { buffer: mockFileBuffer, mimeType: "image/jpeg" },
                signer: expect.any(Object),
                manifest: mockManifest
            });
        }));
        it("should handle signing errors", () => __awaiter(void 0, void 0, void 0, function* () {
            const { createC2pa } = require("c2pa-node");
            const mockC2pa = {
                sign: jest.fn().mockRejectedValue(new Error("Signing failed"))
            };
            createC2pa.mockReturnValue(mockC2pa);
            // Create a new instance to use the mocked c2pa
            const testC2paService = new c2paService_1.C2PAService();
            const result = yield testC2paService.signFile(mockFileBuffer, "image/jpeg", mockManifest);
            expect(result).toBeNull();
        }));
    });
    describe("readManifest", () => {
        const mockFileBuffer = Buffer.from("test file content");
        it("should read manifest successfully", () => __awaiter(void 0, void 0, void 0, function* () {
            const { createC2pa } = require("c2pa-node");
            const mockC2pa = {
                read: jest.fn().mockResolvedValue({ title: "Test Manifest" })
            };
            createC2pa.mockReturnValue(mockC2pa);
            // Create a new instance to use the mocked c2pa
            const testC2paService = new c2paService_1.C2PAService();
            const result = yield testC2paService.readManifest(mockFileBuffer, "image/jpeg");
            expect(result).toEqual({ title: "Test Manifest" });
            expect(mockC2pa.read).toHaveBeenCalledWith({
                buffer: mockFileBuffer,
                mimeType: "image/jpeg"
            });
        }));
        it("should handle reading errors", () => __awaiter(void 0, void 0, void 0, function* () {
            const { createC2pa } = require("c2pa-node");
            const mockC2pa = {
                read: jest.fn().mockRejectedValue(new Error("Reading failed"))
            };
            createC2pa.mockReturnValue(mockC2pa);
            // Create a new instance to use the mocked c2pa
            const testC2paService = new c2paService_1.C2PAService();
            const result = yield testC2paService.readManifest(mockFileBuffer, "image/jpeg");
            expect(result).toBeNull();
        }));
    });
});
