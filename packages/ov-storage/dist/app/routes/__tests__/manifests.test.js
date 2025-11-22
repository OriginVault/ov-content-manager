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
// Mock MinIO methods used by routes
jest.mock("../../minio", () => {
    const putCalls = [];
    const objects = {};
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
            statObject: jest.fn((_bucket, key) => __awaiter(void 0, void 0, void 0, function* () {
                if (objects[key])
                    return { size: 100, metaData: { "content-type": "application/json" } };
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
// Mock c2pa-node
jest.mock("c2pa-node", () => ({
    createC2pa: jest.fn(() => ({
        sign: jest.fn(() => __awaiter(void 0, void 0, void 0, function* () {
            return ({
                signedAsset: {
                    buffer: Buffer.from("signed content"),
                    mimeType: "image/jpeg"
                }
            });
        }))
    })),
    createTestSigner: jest.fn(() => __awaiter(void 0, void 0, void 0, function* () { return ({}); })),
    ManifestBuilder: jest.fn().mockImplementation(() => ({
        asSendable: jest.fn(() => ({
            claim_generator: "ov-content-manager/1.0.0",
            format: "image/jpeg",
            title: "Test Manifest"
        }))
    })),
    // Add missing methods that might be used
    readManifest: jest.fn(() => __awaiter(void 0, void 0, void 0, function* () {
        return ({
            claim_generator: "ov-content-manager/1.0.0",
            format: "image/jpeg",
            title: "Test Manifest"
        });
    }))
}));
// Mock fetch
global.fetch = jest.fn().mockImplementation((url, options) => {
    // Handle PUT requests for file uploads
    if ((options === null || options === void 0 ? void 0 : options.method) === 'PUT') {
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
    let app;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        app = yield (0, createApp_1.createApp)();
    }));
    it("POST /manifests/sign should sign a file with C2PA", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .post("/manifests/sign")
            .send({ fileId: "test-file-id" });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("File signed successfully");
        expect(res.body.signedFileName).toBe("signed-test-file-id");
        expect(res.body.manifestFileName).toBe("manifests/test-file-id");
        expect(res.body.manifest).toBeTruthy();
    }));
    it("POST /manifests/sign should return 400 for missing fileId", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .post("/manifests/sign")
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Missing fileId");
    }));
    it("POST /manifests/webhooks/signing-completed should process webhook", () => __awaiter(void 0, void 0, void 0, function* () {
        const webhookData = {
            fileId: "test-file-id",
            manifestId: "test-manifest-id",
            signatureStatus: "signed",
            attestationId: "test-attestation",
            blockchainRegistrationId: "test-registration",
            timestamp: new Date().toISOString()
        };
        const res = yield (0, supertest_1.default)(app)
            .post("/manifests/webhooks/signing-completed")
            .set("X-Webhook-Signature", "test-signature")
            .send(webhookData);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Webhook processed successfully");
    }));
    it("POST /manifests/webhooks/signing-completed should reject webhook without signature", () => __awaiter(void 0, void 0, void 0, function* () {
        const webhookData = {
            fileId: "test-file-id",
            signatureStatus: "signed"
        };
        const res = yield (0, supertest_1.default)(app)
            .post("/manifests/webhooks/signing-completed")
            .send(webhookData);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Missing webhook signature");
    }));
    it("GET /manifests/list-manifests should list all manifests", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/manifests/list-manifests");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0]).toHaveProperty("name");
        expect(res.body[0]).toHaveProperty("previewUrl");
    }));
    it("GET /manifests/list-public-manifests should list public manifests", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/manifests/list-public-manifests");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0]).toHaveProperty("name");
        expect(res.body[0]).toHaveProperty("previewUrl");
    }));
    it("GET /manifests/manifest/:manifestId should return manifest by ID", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/manifests/manifest/test-manifest");
        expect(res.status).toBe(200);
        expect(res.body.manifest).toBeTruthy();
        expect(res.body.previewUrl).toMatch(/^https:\/\/example.com/);
    }));
    it("GET /manifests/public-manifest/:manifestId should return public manifest by ID", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/manifests/public-manifest/public-manifest");
        expect(res.status).toBe(200);
        expect(res.body.manifest).toBeTruthy();
        expect(res.body.previewUrl).toMatch(/^https:\/\/example.com/);
    }));
    it("GET /manifests/list-user-manifests/:userDID should list user manifests", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/manifests/list-user-manifests/did:cheqd:test");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0]).toHaveProperty("name");
        expect(res.body[0]).toHaveProperty("previewUrl");
    }));
    it("GET /manifests/manifest/:manifestId should return 404 for non-existent manifest", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/manifests/manifest/non-existent");
        expect(res.status).toBe(404);
        expect(res.body.error).toBe("Manifest not found");
    }));
});
