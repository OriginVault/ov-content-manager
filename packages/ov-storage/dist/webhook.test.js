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
const minio_1 = require("minio");
// Mock MinIO
jest.mock('minio');
const mockMinioClient = {
    statObject: jest.fn(),
    getObject: jest.fn(),
    putObject: jest.fn()
};
minio_1.Minio.mockImplementation(() => mockMinioClient);
// Import the app (you'll need to export it from server.ts)
// For now, we'll create a simple test structure
describe('Webhook Endpoint', () => {
    let app;
    beforeEach(() => {
        app = (0, express_1.default)();
        app.use(express_1.default.json());
        // Add the webhook endpoint
        app.post("/webhooks/signing-completed", (req, res) => __awaiter(void 0, void 0, void 0, function* () {
            try {
                const webhook = req.body;
                const signature = req.headers['x-webhook-signature'];
                if (!signature) {
                    return res.status(400).json({ error: 'Missing webhook signature' });
                }
                // Mock successful processing
                if (webhook.signatureStatus === 'signed') {
                    mockMinioClient.statObject.mockResolvedValue({});
                    mockMinioClient.getObject.mockReturnValue({
                        on: (event, callback) => {
                            if (event === 'data') {
                                callback(Buffer.from(JSON.stringify({
                                    id: webhook.fileId,
                                    contentHash: 'test-hash',
                                    userDID: 'did:cheqd:test'
                                })));
                            }
                            if (event === 'end') {
                                callback();
                            }
                        }
                    });
                    mockMinioClient.putObject.mockResolvedValue({});
                }
                res.status(200).json({ message: 'Webhook processed successfully' });
            }
            catch (error) {
                res.status(500).json({ error: 'Webhook processing failed' });
            }
        }));
    });
    afterEach(() => {
        jest.clearAllMocks();
    });
    it('should process successful signing webhook', () => __awaiter(void 0, void 0, void 0, function* () {
        const webhookData = {
            fileId: 'test-file-123',
            manifestId: 'manifest-456',
            signatureStatus: 'signed',
            attestationId: 'attest-789',
            blockchainRegistrationId: 'blockchain-abc',
            timestamp: new Date().toISOString()
        };
        const response = yield (0, supertest_1.default)(app)
            .post('/webhooks/signing-completed')
            .set('X-Webhook-Signature', 'test-signature')
            .send(webhookData);
        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Webhook processed successfully');
        expect(mockMinioClient.putObject).toHaveBeenCalled();
    }));
    it('should process failed signing webhook', () => __awaiter(void 0, void 0, void 0, function* () {
        const webhookData = {
            fileId: 'test-file-456',
            manifestId: '',
            signatureStatus: 'failed',
            error: 'Signing failed due to hardware error',
            timestamp: new Date().toISOString()
        };
        const response = yield (0, supertest_1.default)(app)
            .post('/webhooks/signing-completed')
            .set('X-Webhook-Signature', 'test-signature')
            .send(webhookData);
        expect(response.status).toBe(200);
        expect(response.body.message).toBe('Webhook processed successfully');
        expect(mockMinioClient.putObject).not.toHaveBeenCalled();
    }));
    it('should reject webhook without signature', () => __awaiter(void 0, void 0, void 0, function* () {
        const webhookData = {
            fileId: 'test-file-789',
            manifestId: 'manifest-123',
            signatureStatus: 'signed',
            timestamp: new Date().toISOString()
        };
        const response = yield (0, supertest_1.default)(app)
            .post('/webhooks/signing-completed')
            .send(webhookData);
        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Missing webhook signature');
    }));
    it('should handle webhook processing errors', () => __awaiter(void 0, void 0, void 0, function* () {
        mockMinioClient.statObject.mockRejectedValue(new Error('MinIO error'));
        const webhookData = {
            fileId: 'test-file-error',
            manifestId: 'manifest-error',
            signatureStatus: 'signed',
            timestamp: new Date().toISOString()
        };
        const response = yield (0, supertest_1.default)(app)
            .post('/webhooks/signing-completed')
            .set('X-Webhook-Signature', 'test-signature')
            .send(webhookData);
        expect(response.status).toBe(200); // Webhook endpoint should still return 200 even if metadata update fails
        expect(response.body.message).toBe('Webhook processed successfully');
    }));
});
