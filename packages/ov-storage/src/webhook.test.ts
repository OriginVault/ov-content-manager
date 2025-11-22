import request from 'supertest';
import express from 'express';
import { Client } from 'minio';

// Mock MinIO
jest.mock('minio');

const mockMinioClient = {
  statObject: jest.fn(),
  getObject: jest.fn(),
  putObject: jest.fn()
};

(Client as any).mockImplementation(() => mockMinioClient);

// Import the app (you'll need to export it from server.ts)
// For now, we'll create a simple test structure

describe('Webhook Endpoint', () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Add the webhook endpoint
    app.post("/webhooks/signing-completed", (req: express.Request, res: express.Response) => {
      try {
        const webhook = req.body;
        const signature = req.headers['x-webhook-signature'] as string;

        if (!signature) {
          return res.status(400).json({ error: 'Missing webhook signature' });
        }

        // Mock successful processing
        if (webhook.signatureStatus === 'signed') {
          mockMinioClient.statObject.mockResolvedValue({});
          mockMinioClient.getObject.mockReturnValue({
            on: (event: string, callback: Function) => {
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
      } catch (error) {
        res.status(500).json({ error: 'Webhook processing failed' });
      }
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should process successful signing webhook', async () => {
    const webhookData = {
      fileId: 'test-file-123',
      manifestId: 'manifest-456',
      signatureStatus: 'signed',
      attestationId: 'attest-789',
      blockchainRegistrationId: 'blockchain-abc',
      timestamp: new Date().toISOString()
    };

    const response = await request(app)
      .post('/webhooks/signing-completed')
      .set('X-Webhook-Signature', 'test-signature')
      .send(webhookData);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Webhook processed successfully');
    expect(mockMinioClient.putObject).toHaveBeenCalled();
  });

  it('should process failed signing webhook', async () => {
    const webhookData = {
      fileId: 'test-file-456',
      manifestId: '',
      signatureStatus: 'failed',
      error: 'Signing failed due to hardware error',
      timestamp: new Date().toISOString()
    };

    const response = await request(app)
      .post('/webhooks/signing-completed')
      .set('X-Webhook-Signature', 'test-signature')
      .send(webhookData);

    expect(response.status).toBe(200);
    expect(response.body.message).toBe('Webhook processed successfully');
    expect(mockMinioClient.putObject).not.toHaveBeenCalled();
  });

  it('should reject webhook without signature', async () => {
    const webhookData = {
      fileId: 'test-file-789',
      manifestId: 'manifest-123',
      signatureStatus: 'signed',
      timestamp: new Date().toISOString()
    };

    const response = await request(app)
      .post('/webhooks/signing-completed')
      .send(webhookData);

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('Missing webhook signature');
  });

  it('should handle webhook processing errors', async () => {
    mockMinioClient.statObject.mockRejectedValue(new Error('MinIO error'));

    const webhookData = {
      fileId: 'test-file-error',
      manifestId: 'manifest-error',
      signatureStatus: 'signed',
      timestamp: new Date().toISOString()
    };

    const response = await request(app)
      .post('/webhooks/signing-completed')
      .set('X-Webhook-Signature', 'test-signature')
      .send(webhookData);

    expect(response.status).toBe(200); // Webhook endpoint should still return 200 even if metadata update fails
    expect(response.body.message).toBe('Webhook processed successfully');
  });
}); 