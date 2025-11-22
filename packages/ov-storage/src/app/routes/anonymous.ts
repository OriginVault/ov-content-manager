import express, { Request, Response } from "express";
import multer from "multer";
import { generateSnowflakeId, snowflakeToMnemonic } from "../../generateSnowflakeId.js";
import { loadConfig } from "../config.js";
import { minioClient } from "../minio.js";
import crypto from "crypto";
import logger from "../../logger.js";
import expressRateLimit from "express-rate-limit";
import { storageService } from "../services/storageService.js";
import { c2paService } from "../services/c2paService.js";
import { cleanupService } from "../services/cleanup.js";

const router = express.Router();
const config = loadConfig();

// In-memory store for IP quotas (in production, use Redis)
const ipQuotas = new Map<string, { count: number; resetTime: number }>();

// Multer configuration for anonymous uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.anonymous.maxFileSizeMb * 1024 * 1024, // Convert MB to bytes
  },
});

// Rate limiter for anonymous uploads
const uploadLimiter = expressRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: { error: "Too many upload attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper function to check IP quota
function checkIpQuota(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const quota = ipQuotas.get(ip);
  
  if (!quota || now > quota.resetTime) {
    // Reset quota or create new one
    ipQuotas.set(ip, {
      count: 1,
      resetTime: now + (config.anonymous.ttlHours * 60 * 60 * 1000), // TTL in milliseconds
    });
    return { allowed: true };
  }
  
  if (quota.count >= config.anonymous.maxUploadsPerIp) {
    const retryAfter = Math.ceil((quota.resetTime - now) / 1000);
    return { allowed: false, retryAfter };
  }
  
  quota.count++;
  return { allowed: true };
}

// Helper function to verify hCaptcha
async function verifyHcaptcha(token: string): Promise<boolean> {
  const hcaptchaSecret = process.env.HCAPTCHA_SECRET;
  if (!hcaptchaSecret) {
    logger.warn("HCAPTCHA_SECRET not configured, skipping verification");
    return true;
  }
  
  try {
    const response = await fetch("https://hcaptcha.com/siteverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        secret: hcaptchaSecret,
        response: token,
      }),
    });
    
    const result = await response.json();
    return result.success === true;
  } catch (error) {
    logger.error("hCaptcha verification failed:", error);
    return false;
  }
}

// Helper function to compute file hash
async function computeFileHash(buffer: Buffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Helper function to normalize filename
function normalizeFilename(filename: string): string {
  return filename
    .replace(/[^a-zA-Z0-9.-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");
}

// Anonymous upload endpoint
router.post("/upload-anonymous", uploadLimiter, upload.single("file"), async (req: Request, res: Response): Promise<void> => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    // Check file size
    if (file.size > config.anonymous.maxFileSizeMb * 1024 * 1024) {
      res.status(413).json({ 
        error: `File too large. Maximum size is ${config.anonymous.maxFileSizeMb}MB` 
      });
      return;
    }

    // Verify hCaptcha
    const hcaptchaToken = req.headers["x-hcaptcha-token"] as string;
    if (!hcaptchaToken) {
      res.status(400).json({ error: "hCaptcha token required" });
      return;
    }

    const hcaptchaValid = await verifyHcaptcha(hcaptchaToken);
    if (!hcaptchaValid) {
      res.status(400).json({ error: "Invalid hCaptcha token" });
      return;
    }

    // Check IP quota
    const clientIp = req.ip || req.connection.remoteAddress || "unknown";
    const quotaCheck = checkIpQuota(clientIp);
    if (!quotaCheck.allowed) {
      res.status(429).json({ 
        error: "Upload quota exceeded",
        retryAfter: quotaCheck.retryAfter
      });
      return;
    }

    // Generate snowflake ID and mnemonic
    const snowflake = generateSnowflakeId();
    const mnemonicId = snowflakeToMnemonic(snowflake);

    // Compute file hash
    const contentHash = await computeFileHash(file.buffer);

    // Normalize filename
    const sanitizedName = normalizeFilename(file.originalname || "file");

    // Use MinIO client

    // Store file in anonymous bucket
    const fileKey = `anonymous/uploads/${mnemonicId}/${sanitizedName}`;
    await minioClient.putObject(
      config.minio.bucket,
      fileKey,
      file.buffer,
      file.size,
      {
        "Content-Type": file.mimetype,
        "x-amz-meta-snowflake": snowflake,
        "x-amz-meta-content-hash": contentHash,
        "x-amz-meta-uploader-ip": clientIp,
        "x-amz-meta-upload-time": new Date().toISOString(),
        "x-amz-meta-ttl": new Date(Date.now() + config.anonymous.ttlHours * 60 * 60 * 1000).toISOString(),
      }
    );

    // Generate C2PA manifest for supported file types using enhanced service
    let manifestKey: string | null = null;
    let manifestMnemonicId: string | null = null;

    try {
      if (c2paService.isSupported(file.mimetype)) {
        const manifestResult = await c2paService.generateManifest(file.buffer, {
          title: `Anonymous upload`,
          fileName: sanitizedName,
          fileSize: file.size,
          mimeType: file.mimetype,
          contentHash,
          snowflake,
          mnemonicId,
          uploadTime: new Date(),
          isAnonymous: true,
          clientIp
        });

        if (manifestResult.success && manifestResult.manifest) {
          manifestKey = manifestResult.manifestKey || null;
          manifestMnemonicId = manifestResult.manifestMnemonicId || null;

          // Store manifest if generated successfully
          if (manifestKey) {
            await minioClient.putObject(
              config.minio.bucket,
              manifestKey,
              Buffer.from(JSON.stringify(manifestResult.manifest)),
              JSON.stringify(manifestResult.manifest).length,
              {
                "Content-Type": "application/json",
                "x-amz-meta-snowflake": snowflake,
                "x-amz-meta-uploader-ip": clientIp,
                "x-amz-meta-upload-time": new Date().toISOString(),
                "x-amz-meta-ttl": new Date(Date.now() + config.anonymous.ttlHours * 60 * 60 * 1000).toISOString(),
              }
            );
          }
        } else {
          logger.warn(`Failed to generate C2PA manifest: ${manifestResult.error}`);
        }
      }
    } catch (error) {
      logger.warn("Failed to generate C2PA manifest:", error);
    }

    // Publish Proof-of-Upload DLR via cheqd-studio API
    let pouDidUrl: string | null = null;
    try {
      const anonymousBucketDid = process.env.ANON_BUCKET_DID;
      if (anonymousBucketDid) {
        const uploaderIpHash = crypto.createHash("sha256").update(clientIp).digest("hex");
        
        const pouResponse = await storageService.createProofOfUpload(
          anonymousBucketDid,
          snowflake,
          mnemonicId,
          contentHash,
          sanitizedName,
          file.size,
          file.mimetype,
          uploaderIpHash,
          manifestKey || undefined,
          manifestMnemonicId || undefined
        );
        
        pouDidUrl = pouResponse; // pouResponse is now the resourceId string
        logger.info(`Created Proof-of-Upload DLR: ${pouDidUrl}`);
      }
    } catch (error) {
      logger.warn("Failed to create Proof-of-Upload DLR:", error);
    }

    res.status(200).json({
      snowflake,
      mnemonicId,
      contentHash,
      fileName: sanitizedName,
      size: file.size,
      mimeType: file.mimetype,
      manifestKey,
      manifestMnemonicId,
      pouDidUrl,
      uploadTime: new Date().toISOString(),
      expiresAt: new Date(Date.now() + config.anonymous.ttlHours * 60 * 60 * 1000).toISOString(),
    });

    // Trigger cleanup service after successful upload
    cleanupService.triggerCleanupAfterUpload();

  } catch (error) {
    logger.error("Anonymous upload failed:", error);
    res.status(500).json({ error: "Upload failed" });
  }
});

// Get file by mnemonic (public endpoint)
router.get("/files/by-mnemonic/:mnemonic", async (req: Request, res: Response): Promise<void> => {
  try {
    const { mnemonic } = req.params;
    
    // Convert mnemonic to snowflake (this is a simplified approach)
    // In a real implementation, you'd need a proper mnemonic-to-snowflake mapping
    const snowflake = mnemonic; // Placeholder - implement proper conversion
    
    // List objects with the mnemonic prefix
    const objects = minioClient.listObjects(config.minio.bucket, `anonymous/uploads/${mnemonic}/`, true);
    
    const files: any[] = [];
    for await (const obj of objects) {
      if (obj.name.endsWith("/")) continue; // Skip directories
      
      const stats = await minioClient.statObject(config.minio.bucket, obj.name);
      const presignedUrl = await minioClient.presignedGetObject(
        config.minio.bucket,
        obj.name,
        900 // 15 minutes
      );
      
      files.push({
        name: obj.name.split("/").pop(),
        size: stats.size,
        lastModified: stats.lastModified,
        contentType: stats.metaData?.["content-type"] || "application/octet-stream",
        presignedUrl,
        snowflake: stats.metaData?.["x-amz-meta-snowflake"],
        contentHash: stats.metaData?.["x-amz-meta-content-hash"],
      });
    }
    
    res.status(200).json({
      mnemonic,
      files,
      count: files.length,
    });
    
  } catch (error) {
    logger.error("Get file by mnemonic failed:", error);
    res.status(500).json({ error: "Failed to retrieve file" });
  }
});

// Get manifest by mnemonic (public endpoint)
router.get("/manifests/by-mnemonic/:mnemonic", async (req: Request, res: Response): Promise<void> => {
  try {
    const { mnemonic } = req.params;
    
    const manifestKey = `anonymous/manifests/${mnemonic}/manifest.json`;
    
    try {
      const manifestData = await minioClient.getObject(config.minio.bucket, manifestKey);
      const manifest = await new Promise<string>((resolve, reject) => {
        let data = "";
        manifestData.on("data", chunk => data += chunk);
        manifestData.on("end", () => resolve(data));
        manifestData.on("error", reject);
      });
      
      res.status(200).json(JSON.parse(manifest));
    } catch (error) {
      res.status(404).json({ error: "Manifest not found" });
    }
    
  } catch (error) {
    logger.error("Get manifest by mnemonic failed:", error);
    res.status(500).json({ error: "Failed to retrieve manifest" });
  }
});

// Get Proof-of-Upload DLRs for a DID (public endpoint)
router.get("/proof-of-upload/:did", async (req: Request, res: Response): Promise<void> => {
  try {
    const { did } = req.params;
    const { resourceType = "proof-of-upload", name, version, time } = req.query;
    
    // TODO: Implement resource listing using parentStore.agent
    // For now, return empty array
    const resources: any[] = [];
    
    res.status(200).json({
      did,
      resources,
      count: resources.length,
    });
    
  } catch (error) {
    logger.error("Get Proof-of-Upload DLRs failed:", error);
    res.status(500).json({ error: "Failed to retrieve Proof-of-Upload DLRs" });
  }
});

export default router;
