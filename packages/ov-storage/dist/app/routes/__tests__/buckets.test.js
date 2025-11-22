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
    const buckets = ["test-bucket", "another-bucket"];
    const objects = {
        "test-bucket": [
            { name: "file1.jpg", size: 2097152, lastModified: new Date(), etag: "etag1" }, // 2MB
            { name: "file2.png", size: 3145728, lastModified: new Date(), etag: "etag2" } // 3MB
        ]
    };
    return {
        minioClient: {
            makeBucket: jest.fn((bucketName) => __awaiter(void 0, void 0, void 0, function* () {
                buckets.push(bucketName);
                return {};
            })),
            bucketExists: jest.fn((bucketName) => __awaiter(void 0, void 0, void 0, function* () {
                return buckets.includes(bucketName);
            })),
            listBuckets: jest.fn(() => __awaiter(void 0, void 0, void 0, function* () {
                return buckets.map(name => ({ name }));
            })),
            listObjects: jest.fn((bucketName) => __awaiter(void 0, void 0, void 0, function* () {
                return objects[bucketName] || [];
            })),
            listObjectsV2: jest.fn((bucketName) => {
                function gen() {
                    return __asyncGenerator(this, arguments, function* gen_1() {
                        const bucketObjects = objects[bucketName] || [];
                        for (const obj of bucketObjects) {
                            yield yield __await(obj);
                        }
                    });
                }
                return gen();
            }),
            presignedGetObject: jest.fn((bucket, key) => __awaiter(void 0, void 0, void 0, function* () { return `https://example.com/get/${bucket}/${key}`; })),
            statObject: jest.fn((bucket, key) => __awaiter(void 0, void 0, void 0, function* () {
                return ({
                    size: 2097152, // 2MB
                    lastModified: new Date(),
                    etag: "test-etag",
                    metaData: { "content-type": "image/jpeg" }
                });
            })),
            copyObject: jest.fn((destBucket, destObject, source) => __awaiter(void 0, void 0, void 0, function* () {
                return {};
            })),
            removeObjects: jest.fn((bucketName, objectNames) => __awaiter(void 0, void 0, void 0, function* () {
                if (objects[bucketName]) {
                    objects[bucketName] = objects[bucketName].filter(obj => !objectNames.includes(obj.name));
                }
                return {};
            })),
            removeBucket: jest.fn((bucketName) => __awaiter(void 0, void 0, void 0, function* () {
                const index = buckets.indexOf(bucketName);
                if (index > -1) {
                    buckets.splice(index, 1);
                }
                return {};
            })),
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
describe("bucket routes (modular)", () => {
    let app;
    beforeAll(() => __awaiter(void 0, void 0, void 0, function* () {
        app = yield (0, createApp_1.createApp)();
    }));
    it("POST /buckets/create_bucket should create a new bucket", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .post("/buckets/create_bucket")
            .send({ bucketName: "new-test-bucket" });
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Bucket new-test-bucket created successfully");
    }));
    it("POST /buckets/create_bucket should return 400 for missing bucketName", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .post("/buckets/create_bucket")
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Missing bucketName");
    }));
    it("GET /buckets/bucket_exists should check if bucket exists", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .get("/buckets/bucket_exists?bucketName=test-bucket");
        expect(res.status).toBe(200);
        expect(res.body.exists).toBe(true);
        expect(res.body.bucketName).toBe("test-bucket");
    }));
    it("GET /buckets/bucket_exists should return 400 for missing bucketName", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/buckets/bucket_exists");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Missing bucketName query parameter");
    }));
    it("GET /buckets/list_buckets should list all buckets", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/buckets/list_buckets");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0]).toHaveProperty("name");
    }));
    it("GET /buckets/list_files/:bucketName should list files in bucket", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/buckets/list_files/test-bucket");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBeGreaterThan(0);
        expect(res.body[0]).toHaveProperty("name");
        expect(res.body[0]).toHaveProperty("size");
    }));
    it("GET /buckets/list_files/:bucketName should handle prefix and recursive params", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .get("/buckets/list_files/test-bucket?prefix=file&recursive=false");
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    }));
    it("POST /buckets/request-download-url should return presigned URL", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .post("/buckets/request-download-url")
            .send({ fileName: "test-file.jpg" });
        expect(res.status).toBe(200);
        expect(res.body.downloadUrl).toMatch(/^https:\/\/example.com/);
    }));
    it("POST /buckets/request-download-url should return 400 for missing fileName", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .post("/buckets/request-download-url")
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Missing fileName");
    }));
    it("GET /buckets/bucket_stats/:bucketName should return bucket statistics", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/buckets/bucket_stats/test-bucket");
        expect(res.status).toBe(200);
        expect(res.body.bucketName).toBe("test-bucket");
        expect(res.body.objectCount).toBeGreaterThan(0);
        expect(res.body.totalSize).toBeGreaterThan(0);
        expect(res.body.totalSizeMB).toBeGreaterThan(0);
        expect(res.body.fileTypes).toBeTruthy();
    }));
    it("DELETE /buckets/delete_bucket/:bucketName should delete bucket", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).delete("/buckets/delete_bucket/test-bucket");
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Bucket test-bucket deleted successfully");
    }));
    it("GET /buckets/object_metadata/:bucketName/* should return object metadata", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app).get("/buckets/object_metadata/test-bucket/test-file.jpg");
        expect(res.status).toBe(200);
        expect(res.body.bucketName).toBe("test-bucket");
        expect(res.body.objectName).toBe("test-file.jpg");
        expect(res.body.size).toBe(2097152);
        expect(res.body.contentType).toBe("image/jpeg");
        expect(res.body.metadata).toBeTruthy();
    }));
    it("POST /buckets/copy_object should copy object", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
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
    }));
    it("POST /buckets/copy_object should return 400 for missing parameters", () => __awaiter(void 0, void 0, void 0, function* () {
        const res = yield (0, supertest_1.default)(app)
            .post("/buckets/copy_object")
            .send({
            sourceBucket: "source-bucket"
            // Missing other required parameters
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Missing required parameters");
    }));
});
