import express, { Request, Response } from "express";
import { loadConfig } from "../config.js";
import { minioClient } from "../minio.js";
import { requireAuth } from "../auth.js";
import { storageService } from "../services/storageService.js";
import logger from "../../logger.js";
import expressRateLimit from "express-rate-limit";

const router = express.Router();
const config = loadConfig();

// Rate limiter for storage operations
const storageLimiter = expressRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: { error: "Too many storage operations, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Helper function to extract user info from auth
function getUserInfo(req: Request): { userId: string; mainDid?: string } {
  const auth = (req as any).auth;
  if (!auth || !auth.sub) {
    throw new Error("User not authenticated");
  }
  
  return {
    userId: auth.sub,
    mainDid: auth.mainDid,
  };
}

// Helper function to check if user can access storage DID
async function canAccessStorageDid(userId: string, storageDid: string): Promise<boolean> {
  try {
    // Check if this is the user's own storage DID
    const userStorageDid = await storageService.findUserStorageDid(userId);
    if (userStorageDid === storageDid) {
      return true;
    }

    // TODO: Check if user's main DID is a controller of the storage DID
    // This would require DID document verification
    
    return false;
  } catch (error) {
    logger.warn(`Failed to verify storage DID access for user ${userId}:`, error);
    return false;
  }
}

// Helper function to normalize S3 keys
function normalizeKey(key: string): string {
  return key.replace(/^\/+/, "").replace(/\/+$/, "");
}

// Helper function to validate key prefix
function validateKeyPrefix(key: string, userId: string): boolean {
  const normalizedKey = normalizeKey(key);
  const expectedPrefix = `users/${userId}/`;
  return normalizedKey.startsWith(expectedPrefix);
}

// List objects in storage bucket
router.get("/b/:did/objects", storageLimiter, requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const { did } = req.params;
    const { prefix = "", cursor = "", limit = "50" } = req.query;
    const { userId } = getUserInfo(req);

    // Check if user can access this storage DID
    const canAccess = await canAccessStorageDid(userId, did);
    if (!canAccess) {
      res.status(403).json({ error: "Access denied to storage bucket" });
      return;
    }

    const limitNum = Math.min(parseInt(limit as string) || 50, 100); // Max 100 items
    const normalizedPrefix = normalizeKey(prefix as string);
    
    // Ensure prefix starts with user's directory
    if (normalizedPrefix && !validateKeyPrefix(normalizedPrefix, userId)) {
      res.status(400).json({ error: "Invalid key prefix" });
      return;
    }

    const objects = minioClient.listObjects(config.minio.bucket, normalizedPrefix, true);
    const items: any[] = [];
    let count = 0;
    let nextCursor = "";

    for await (const obj of objects) {
      if (count >= limitNum) {
        nextCursor = obj.name;
        break;
      }

      if (obj.name === cursor) {
        continue; // Skip until we reach the cursor
      }

      try {
        const stats = await minioClient.statObject(config.minio.bucket, obj.name);
        items.push({
          key: obj.name,
          size: stats.size,
          lastModified: stats.lastModified,
          etag: stats.etag,
          contentType: stats.metaData?.["content-type"] || "application/octet-stream",
        });
        count++;
      } catch (error) {
        logger.warn(`Failed to get stats for object ${obj.name}:`, error);
      }
    }

    res.status(200).json({
      items,
      nextCursor: nextCursor || null,
      count: items.length,
    });

  } catch (error) {
    logger.error("List objects failed:", error);
    res.status(500).json({ error: "Failed to list objects" });
  }
});

// Generate presigned URL for download
router.get("/b/:did/presign", storageLimiter, requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const { did } = req.params;
    const { op = "get", key, expires = "900" } = req.query;
    const { userId } = getUserInfo(req);

    if (!key || typeof key !== "string") {
      res.status(400).json({ error: "Key parameter is required" });
      return;
    }

    // Check if user can access this storage DID
    const canAccess = await canAccessStorageDid(userId, did);
    if (!canAccess) {
      res.status(403).json({ error: "Access denied to storage bucket" });
      return;
    }

    const normalizedKey = normalizeKey(key);
    
    // Ensure key starts with user's directory
    if (!validateKeyPrefix(normalizedKey, userId)) {
      res.status(400).json({ error: "Invalid key" });
      return;
    }

    const expiresNum = Math.min(parseInt(expires as string) || 900, 3600); // Max 1 hour

    let presignedUrl: string;
    if (op === "get") {
      presignedUrl = await minioClient.presignedGetObject(config.minio.bucket, normalizedKey, expiresNum);
    } else if (op === "head") {
      presignedUrl = await minioClient.presignedUrl("HEAD", config.minio.bucket, normalizedKey, expiresNum);
    } else {
      res.status(400).json({ error: "Invalid operation. Use 'get' or 'head'" });
      return;
    }

    res.status(200).json({
      presignedUrl,
      expires: expiresNum,
      key: normalizedKey,
    });

  } catch (error) {
    logger.error("Generate presigned URL failed:", error);
    res.status(500).json({ error: "Failed to generate presigned URL" });
  }
});

// Generate presigned URL for upload
router.post("/b/:did/presign", storageLimiter, requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const { did } = req.params;
    const { op = "put", key, contentType, contentLength } = req.body;
    const { userId } = getUserInfo(req);

    if (!key || typeof key !== "string") {
      res.status(400).json({ error: "Key parameter is required" });
      return;
    }

    if (op !== "put") {
      res.status(400).json({ error: "Invalid operation. Use 'put'" });
      return;
    }

    // Check if user can access this storage DID
    const canAccess = await canAccessStorageDid(userId, did);
    if (!canAccess) {
      res.status(403).json({ error: "Access denied to storage bucket" });
      return;
    }

    const normalizedKey = normalizeKey(key);
    
    // Ensure key starts with user's directory
    if (!validateKeyPrefix(normalizedKey, userId)) {
      res.status(400).json({ error: "Invalid key" });
      return;
    }

    // Check file size limits
    const maxFileSize = config.user?.maxFileSizeMb || 100;
    const maxFileSizeBytes = maxFileSize * 1024 * 1024;
    
    if (contentLength && contentLength > maxFileSizeBytes) {
      res.status(413).json({ 
        error: `File too large. Maximum size is ${maxFileSize}MB` 
      });
      return;
    }

    // Check bucket size limits
    const maxBucketSize = config.user?.maxBucketSizeGb || 10;
    const maxBucketSizeBytes = maxBucketSize * 1024 * 1024 * 1024;
    
    // TODO: Implement bucket size checking
    // This would require scanning the bucket to calculate current size

    const expiresNum = config.user?.presignDefaultExpirySeconds || 900;

    const presignedUrl = await minioClient.presignedPutObject(
      config.minio.bucket,
      normalizedKey,
      expiresNum
    );

    res.status(200).json({
      presignedUrl,
      expires: expiresNum,
      key: normalizedKey,
      headers: {
        "Content-Type": contentType || "application/octet-stream",
      },
    });

  } catch (error) {
    logger.error("Generate upload presigned URL failed:", error);
    res.status(500).json({ error: "Failed to generate upload presigned URL" });
  }
});

// Delete object
router.delete("/b/:did/objects/delete/:key", storageLimiter, requireAuth as any, async (req: Request, res: Response): Promise<void> => {
  try {
    const { did, key } = req.params;
    const { userId } = getUserInfo(req);

    // Check if user can access this storage DID
    const canAccess = await canAccessStorageDid(userId, did);
    if (!canAccess) {
      res.status(403).json({ error: "Access denied to storage bucket" });
      return;
    }

    const normalizedKey = normalizeKey(key);
    
    // Ensure key starts with user's directory
    if (!validateKeyPrefix(normalizedKey, userId)) {
      res.status(400).json({ error: "Invalid key" });
      return;
    }

    await minioClient.removeObject(config.minio.bucket, normalizedKey);

    res.status(200).json({
      message: "Object deleted successfully",
      key: normalizedKey,
    });

  } catch (error) {
    logger.error("Delete object failed:", error);
    res.status(500).json({ error: "Failed to delete object" });
  }
});

export default router;
