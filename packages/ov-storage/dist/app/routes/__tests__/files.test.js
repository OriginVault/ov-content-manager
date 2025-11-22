"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = Object.create((typeof AsyncIterator === "function" ? AsyncIterator : Object).prototype), verb("next"), verb("throw"), verb("return", awaitReturn), i[Symbol.asyncIterator] = function () { return this; }, i;
    function awaitReturn(f) { return function (v) { return Promise.resolve(v).then(f, reject); }; }
    function verb(n, f) { if (g[n]) { i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; if (f) i[n] = f(i[n]); } }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const supertest_1 = __importDefault(require("supertest"));
const createApp_1 = require("../../createApp");
// Mock auth to always allow
jest.mock("../../auth", () => ({
    requireAuth: (req, _res, next) => next(),
}));
// Mock ID functions
jest.mock("../../ids", () => ({
    generateSnowflakeId: jest.fn(() => "123456789"),
    snowflakeToMnemonic: jest.fn((snowflake) => `mnemonic-${snowflake}`),
    mnemonicToSnowflake: jest.fn((mnemonic) => {
        // Handle the test case where mnemonic is "test mnemonic"
        if (mnemonic === "test mnemonic")
            return "123456789";
        return mnemonic.replace("mnemonic-", "");
    }),
}));
// Mock MinIO methods used by routes
jest.mock("../../minio", () => {
    const putCalls = [];
    const objects = {};
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
            statObject: jest.fn((_bucket, key) => __awaiter(void 0, void 0, void 0, function* () {
                if (objects[key])
                    return { size: 100, metaData: { "content-type": "image/jpeg" } };
                return Promise.reject(new Error("not found"));
            })),
            getObject: jest.fn((_bucket, key) => __awaiter(void 0, void 0, void 0, function* () {
                if (!(key in objects))
                    throw new Error("not found");
                const { Readable } = yield Promise.resolve().then(() => __importStar(require("stream")));
                const s = new Readable();
                s.push(Buffer.from(objects[key]));
                s.push(null);
                return s;
            })),
            putObject: jest.fn((_bucket, key, body) => __awaiter(void 0, void 0, void 0, function* () {
                objects[key] = body.toString();
                putCalls.push({ key });
                return {};
            })),
            presignedGetObject: jest.fn((_bucket, key) => __awaiter(void 0, void 0, void 0, function* () { return `https://example.com/get/${encodeURIComponent(key)}`; })),
            presignedPutObject: jest.fn((_bucket, key) => __awaiter(void 0, void 0, void 0, function* () { return `https://example.com/put/${encodeURIComponent(key)}`; })),
            listObjectsV2: jest.fn((_bucket, prefix) => {
                function gen() {
                    return __asyncGenerator(this, arguments, function* gen_1() {
                        for (const key of Object.keys(objects)) {
                            if (key.startsWith(prefix)) {
                                yield yield __await({ name: key, etag: "e", size: 1, lastModified: new Date() });
                            }
                        }
                    });
                }
                return gen();
            }),
            removeObjects: jest.fn((_bucket, keys) => __awaiter(void 0, void 0, void 0, function* () {
                for (const k of keys)
                    delete objects[k];
            })),
            removeObject: jest.fn((_bucket, key) => __awaiter(void 0, void 0, void 0, function* () { delete objects[key]; })),
        },
        streamToBuffer: (s) => __awaiter(void 0, void 0, void 0, function* () {
            var _a, s_1, s_1_1;
            var _b, e_1, _c, _d;
            const chunks = [];
            try {
                for (_a = true, s_1 = __asyncValues(s); s_1_1 = yield s_1.next(), _b = s_1_1.done, !_b; _a = true) {
                    _d = s_1_1.value;
                    _a = false;
                    const c = _d;
                    chunks.push(Buffer.from(c));
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_a && !_b && (_c = s_1.return)) yield _c.call(s_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
            return Buffer.concat(chunks);
        }),
    };
});
describe("files routes (modular)", () => {
    let app;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        app = yield (0, createApp_1.createApp)();
    }));
    it("GET / should respond", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/");
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/C2PA Modular Server/);
    }));
    it("POST /files/request-upload-url should create identity and return presigned URL", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
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
    }));
    it("POST /files/check-file-uploaded should detect existing", () => __awaiter(void 0, void 0, void 0, function* () {
        // Use same contentHash as above
        const res = yield (0, supertest_1.default)(app)
            .post("/files/check-file-uploaded")
            .send({ contentHash: "hash1", userDID: "did:cheqd:test" });
        expect(res.status).toBe(200);
        expect(res.body.existing).toBe(true);
    }));
    it("POST /files/request-public-upload-url should return two presigned URLs", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
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
    }));
    it("POST /files/publish-private-file should publish file to public", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
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
    }));
    it("GET /files/list-user-files/:userDID should list user files", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/files/list-user-files/did:cheqd:test");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    }));
    it("GET /files/list-public-files should list public files", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/files/list-public-files");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    }));
    it("POST /files/get-file-by-mnemonic should return file by mnemonic", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .post("/files/get-file-by-mnemonic")
            .send({
            mnemonic: "test mnemonic",
            userDID: "did:cheqd:test"
        });
        expect(res.status).toBe(200);
        expect(res.body.fileId).toBeTruthy();
        expect(res.body.downloadUrl).toMatch(/^https:\/\/example.com/);
    }));
    it("POST /files/get-public-file-by-mnemonic should return public file by mnemonic", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .post("/files/get-public-file-by-mnemonic")
            .send({
            mnemonic: "test mnemonic",
            username: "alice"
        });
        expect(res.status).toBe(200);
        expect(res.body.fileId).toBeTruthy();
        expect(res.body.downloadUrl).toMatch(/^https:\/\/example.com/);
    }));
    it("DELETE /files/delete-upload/:userDID/:fileId should delete upload", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).delete("/files/delete-upload/did:cheqd:test/123456789");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Upload and related metadata deleted");
    }));
    it("DELETE /files/delete-manifest/:userDID/:manifestId should delete manifest", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).delete("/files/delete-manifest/did:cheqd:test/manifest123");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Manifest deleted successfully");
    }));
    it("DELETE /files/delete-public-manifest/:username/:manifestId should delete public manifest", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).delete("/files/delete-public-manifest/alice/manifest123");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Manifest deleted successfully");
    }));
    it("GET /files/identity/:contentHash should return identity metadata", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/files/identity/hash1");
        expect(res.status).toBe(200);
        expect(res.body.metadata).toBeTruthy();
    }));
});
