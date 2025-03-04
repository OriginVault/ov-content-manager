import express, { Request, Response } from "express";
import { createC2pa, createTestSigner, ManifestBuilder } from "c2pa-node";
import logger from "./logger";
import * as Minio from 'minio'
import dotenv from 'dotenv';

dotenv.config();

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'localhost',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER || 'minioadmin',
  secretKey: process.env.MINIO_ROOT_PASSWORD || 'minioadmin',
})

const app = express();
app.use(express.json());

const BUCKET = process.env.MINIO_BUCKET || 'ov-content-manager-uploads';

// Load base URL from environment variable
const BASE_URL = process.env.BASE_URL || 'http://storage.ov.box'; // Default value if not set

// In-memory store for presigned URLs
const urlStore: { [key: string]: { url: string; expiresAt: number } } = {};

// Function to generate a unique URI
function generateUniqueURI(): string {
  return `uri-${Date.now()}`; // Simple unique identifier based on timestamp
}

// Middleware to clean up expired URLs
setInterval(() => {
  const now = Date.now();
  for (const key in urlStore) {
    if (urlStore[key].expiresAt < now) {
      delete urlStore[key];
    }
  }
}, 60000); // Check every minute

// Helper: Convert MinIO Stream to Buffer
function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

// C2PA Signing Endpoint
app.post("/sign", async (req: Request, res: Response) => {
  try {
    const { fileName } = req.body;

    // Use a presigned URL to securely fetch the file
    const presignedUrl = await minioClient.presignedGetObject(BUCKET, fileName, 60);
    const response = await fetch(presignedUrl);

    if (!response.body) {
      throw new Error("No response body");
    }

    // Convert the response body to a NodeJS.ReadableStream
    const buffer = await streamToBuffer(response.body as unknown as NodeJS.ReadableStream);

    // Instantiate C2pa
    const c2pa = createC2pa();

    // Sign the file
    const signer = await createTestSigner();
    const asset = { buffer, mimeType: 'image/jpeg' };

    // Provide the required arguments to ManifestBuilder
    const manifest = new ManifestBuilder({
      claim_generator: 'my-app/1.0.0',
      format: 'image/jpeg',
      title: 'Test Manifest',
      assertions: [
        {
          label: 'c2pa.actions',
          data: {
            actions: [
              {
                action: 'c2pa.created',
              },
            ],
          },
        },
        {
          label: 'com.custom.my-assertion',
          data: {
            description: 'Test Description',
            version: '1.0.0',
          },
        },
      ],
    });

    const signedBuffer = await c2pa.sign({ asset, signer, manifest });

    // Upload signed file securely
    const signedFileName = `signed-${fileName}`;
    const uploadUrl = await minioClient.presignedPutObject(BUCKET, signedFileName, 60);
    await fetch(uploadUrl, { method: "PUT", body: JSON.stringify(signedBuffer) });

    logger.info(`Signed file ${signedFileName} uploaded successfully`);

    res.json({ message: "File signed successfully!", signedFile: signedFileName });
  } catch (error) {
    logger.error((error as Error).message);
    res.status(500).json({ error: "Signing failed" });
  }
});

app.get("/health", async (req: Request, res: Response) => {
  try {
    // Check MinIO server status
    await minioClient.listBuckets(); // This will throw an error if the MinIO server is not reachable

    res.json({ message: "C2PA Server is healthy and MinIO is reachable" });
  } catch (error) {
    logger.error("MinIO server is not reachable: " + (error as Error).message);
    res.status(500).json({ message: "C2PA Server is healthy, but MinIO is not reachable" });
  }
});

app.post("/create_bucket", async (req: Request, res: Response) => {
  const { bucketName } = req.body;
  try {
    await minioClient.makeBucket(bucketName, "us-east-1");
    res.json({ message: `Bucket ${bucketName} created successfully` });
  } catch (error) {
    logger.error("Error creating bucket: " + (error as Error).message);
    res.status(500).json({ error: "Bucket creation failed" });
  }
});

app.get("/bucket_exists", async (req: Request, res: Response) => {
  const { bucketName } = req.body;
  const bucket = await minioClient.bucketExists(bucketName);
  res.json(bucket);
});

app.post("/get_upload_url", async (req: Request, res: Response) => {
  const { fileName } = req.body;
  console.log("get_upload_url", fileName);
  try {
    const upload_url = await minioClient.presignedPutObject(BUCKET, fileName, 60);
    const uniqueURI = generateUniqueURI();
    urlStore[uniqueURI] = { url: upload_url, expiresAt: Date.now() + 15 * 60 * 1000 }; // Store for 15 minutes
    res.json({ upload_url: `${BASE_URL}/upload/${uniqueURI}` });
  } catch (error) {
    logger.error("Error getting presigned url: " + (error as Error).message);
    res.status(500).json({ error: "Presigned url retrieval failed" });
  }
});

app.get("/get_download_url", async (req: Request, res: Response) => {
  const { fileName } = req.body;
  try {
    const download_url = await minioClient.presignedGetObject(BUCKET, fileName, 60);
    const uniqueURI = generateUniqueURI();
    urlStore[uniqueURI] = { url: download_url, expiresAt: Date.now() + 15 * 60 * 1000 }; // Store for 15 minutes
    res.json({ download_url: `${BASE_URL}/download/${uniqueURI}` });
  } catch (error) {
    logger.error("Error getting presigned url: " + (error as Error).message);
    res.status(500).json({ error: "Presigned url retrieval failed" });
  }
});

app.get("/list_buckets", async (req: Request, res: Response) => {
  const buckets = await minioClient.listBuckets();
  res.json(buckets);
});

app.get("/", (req: Request, res: Response) => {
  res.json({ message: "C2PA Server is running" });
});

// New endpoint to handle redirects
app.get("/upload/:uri", (req: Request, res: Response) => {
  const { uri } = req.params;
  const entry = urlStore[uri];
  if (entry) {
    res.redirect(entry.url);
  } else {
    res.status(404).json({ error: "Upload URL not found or expired" });
  }
});

app.get("/download/:uri", (req: Request, res: Response) => {
  const { uri } = req.params;
  const entry = urlStore[uri];
  if (entry) {
    res.redirect(entry.url);
  } else {
    res.status(404).json({ error: "Download URL not found or expired" });
  }
});

// Start Server
app.listen(8080, async () => {
  const uploadsExists = await minioClient.bucketExists(BUCKET);
  if (!uploadsExists) {
    await minioClient.makeBucket(BUCKET, "us-east-1");
  }

  console.log("C2PA Server running on port 8080")
}); 