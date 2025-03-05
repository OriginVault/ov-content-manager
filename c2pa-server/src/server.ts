import express, { Request, Response, NextFunction } from "express";
import { createC2pa, createTestSigner, ManifestBuilder } from "c2pa-node";
import logger from "./logger";
import * as Minio from 'minio'
import dotenv from 'dotenv';
import multer from 'multer'; // Import multer for handling file uploads
import cors from 'cors';
import expressRateLimit from 'express-rate-limit';

dotenv.config();

// Extend the Request interface to include the file property
interface MulterRequest extends Request {
  file: any;
}

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || 'minio',
  port: parseInt(process.env.MINIO_PORT || '9000'),
  useSSL: true,
  accessKey: process.env.MINIO_ROOT_USER || 'minioadmin',
  secretKey: process.env.MINIO_ROOT_PASSWORD || 'minioadmin',
})

const app = express();
app.use(express.json());

// Use the cors middleware
app.use((req, res, next) => {
    const allowedOrigin = req.headers.origin;
    res.header("Access-Control-Allow-Origin", allowedOrigin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    next();
});

// Handle preflight requests
app.options('*', cors());

const BUCKET = process.env.MINIO_BUCKET || 'ov-content-manager-uploads';

// In-memory store for presigned URLs
const urlStore: { [key: string]: { url: string; expiresAt: number } } = {};

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

// Set up rate limiting
const limiter = expressRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply the rate limiting middleware to all requests
app.use(limiter as any);

// Create a specific rate limiter for upload-related routes
const uploadLimiter = expressRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply the upload limiter to the specific routes
app.post("/request-upload-url", uploadLimiter as any, async (req: Request, res: Response) => {
  const { fileName } = req.body;

  try {
    const upload_url = await minioClient.presignedPutObject(BUCKET, fileName, 60);
    res.json({ upload_url });
  } catch (error) {
    logger.error("Error getting presigned url: " + (error as Error).message);
    res.status(500).json({ error: "Presigned url retrieval failed" });
  }
});

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
      claim_generator: 'ov-content-manager/1.0.0',
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
    await fetch(uploadUrl, { method: "POST", body: JSON.stringify(signedBuffer) });

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

app.post("/request-download-url", async (req: Request, res: Response) => {
  const { fileName } = req.body;
  try {
    const download_url = await minioClient.presignedGetObject(BUCKET, fileName, 60);
    res.json({ download_url });
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

// Set up multer for file uploads
const upload = multer({ storage: multer.memoryStorage() }); // Store files in memory

// Update the upload endpoint to use the upload limiter
app.post("/upload/:uri", uploadLimiter as any, upload.single('file'), async (req: Request, res: Response): Promise<void> => {
  const { uri } = req.params;
  const entry = urlStore[uri];

  if (!entry) {
    res.status(404).json({ error: "Upload URL not found or expired" });
    return; // Ensure the function returns void
  }

  try {
    // Use a type assertion to inform TypeScript that req is a MulterRequest
    const file = (req as MulterRequest).file;

    // Upload the file to MinIO using the presigned URL
    const uploadResponse = await fetch(entry.url, {
      method: "POST",
      body: file.buffer,
      headers: {
        'Content-Type': file.mimetype,
      },
    });

    if (!uploadResponse.ok) {
      throw new Error("Failed to upload file to MinIO");
    }

    res.json({ message: "File uploaded successfully!", uploadResponse });
  } catch (error) {
    logger.error("Error uploading file: " + (error as Error).message);
    res.status(500).json({ error: "File upload failed" });
  }
});

// Update /download/:uri endpoint to handle file downloads
app.get("/download/:uri", async (req: Request, res: Response): Promise<void> => {
  const { uri } = req.params;
  const entry = urlStore[uri];

  if (!entry) {
    res.status(404).json({ error: "Download URL not found or expired" });
    return; // Ensure the function returns void
  }

  try {
    // Fetch the file from MinIO using the presigned URL
    const downloadResponse = await fetch(entry.url);

    if (!downloadResponse.ok) {
      throw new Error("Failed to download file from MinIO");
    }

    const arrayBuffer = await downloadResponse.arrayBuffer(); // Get the file as an ArrayBuffer
    const fileBuffer = Buffer.from(arrayBuffer); // Convert ArrayBuffer to Buffer

    // Set the appropriate headers for the response
    res.setHeader('Content-Type', downloadResponse.headers.get('Content-Type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${uri}"`); // Set the filename

    res.send(fileBuffer); // Send the file buffer as the response
  } catch (error) {
    logger.error("Error downloading file: " + (error as Error).message);
    res.status(500).json({ error: "File download failed" });
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