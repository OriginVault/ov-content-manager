import { Request, Response, Router } from "express";
import { minioClient } from "../minio.js";
import logger from "../../logger.js";
import { requireAuth } from "../auth.js";
import { BucketService } from "../services/bucketService.js";
import { loadConfig } from "../config.js";
import expressRateLimit from "express-rate-limit";

const router = Router();

// Rate limiter for bucket management endpoints
const bucketLimiter = expressRateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
});

// Initialize bucket service
const config = loadConfig();
const bucketService = new BucketService(minioClient);

/**
 * GET /bucket/quota - Get current user's quota information
 */
router.get("/quota", requireAuth as any, bucketLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = (req as any).auth;
    if (!auth || !auth.sub) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const userId = auth.sub;
    const storageDid = auth.mainDid;

    if (!storageDid) {
      res.status(400).json({ error: "No storage DID found for user" });
      return;
    }

    const quotaInfo = await bucketService.getQuotaInfo(userId, storageDid);
    
    res.status(200).json({
      success: true,
      quota: {
        userId: quotaInfo.userId,
        storageDid: quotaInfo.storageDid,
        currentUsage: quotaInfo.currentUsage,
        maxQuota: quotaInfo.maxQuota,
        usagePercentage: quotaInfo.usagePercentage,
        isOverQuota: quotaInfo.isOverQuota,
        formattedUsage: bucketService.formatBytes(quotaInfo.currentUsage),
        formattedMaxQuota: bucketService.formatBytes(quotaInfo.maxQuota),
        remainingQuota: quotaInfo.maxQuota - quotaInfo.currentUsage,
        formattedRemainingQuota: bucketService.formatBytes(quotaInfo.maxQuota - quotaInfo.currentUsage)
      },
      files: quotaInfo.files.map(file => ({
        ...file,
        formattedSize: bucketService.formatBytes(file.size)
      }))
    });

  } catch (error) {
    logger.error("Failed to get quota information:", error);
    res.status(500).json({ 
      error: "Failed to get quota information",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * GET /bucket/stats - Get bucket statistics for current user
 */
router.get("/stats", requireAuth as any, bucketLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = (req as any).auth;
    if (!auth || !auth.sub) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const userId = auth.sub;
    const storageDid = auth.mainDid;

    if (!storageDid) {
      res.status(400).json({ error: "No storage DID found for user" });
      return;
    }

    const stats = await bucketService.getBucketStats(storageDid);
    
    res.status(200).json({
      success: true,
      stats: {
        ...stats,
        formattedTotalSize: bucketService.formatBytes(stats.totalSize),
        formattedFileTypes: Object.entries(stats.fileTypes).map(([ext, count]) => ({
          extension: ext,
          count,
          percentage: ((count / stats.fileCount) * 100).toFixed(1)
        }))
      }
    });

  } catch (error) {
    logger.error("Failed to get bucket statistics:", error);
    res.status(500).json({ 
      error: "Failed to get bucket statistics",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * POST /bucket/cleanup - Clean up old files to free up space
 */
router.post("/cleanup", requireAuth as any, bucketLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = (req as any).auth;
    if (!auth || !auth.sub) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const userId = auth.sub;
    const storageDid = auth.mainDid;

    if (!storageDid) {
      res.status(400).json({ error: "No storage DID found for user" });
      return;
    }

    const { targetSizeGB, keepRecentHours } = req.body;
    const targetSize = (targetSizeGB || config.user.maxBucketSizeGb * 0.8) * 1024 * 1024 * 1024; // Default to 80% of max quota
    const keepHours = keepRecentHours || 24;

    const cleanupResult = await bucketService.cleanupOldFiles(storageDid, targetSize, keepHours);
    
    res.status(200).json({
      success: true,
      cleanup: {
        removedFiles: cleanupResult.removedFiles,
        freedSpace: cleanupResult.freedSpace,
        formattedFreedSpace: bucketService.formatBytes(cleanupResult.freedSpace),
        targetSize: targetSize,
        formattedTargetSize: bucketService.formatBytes(targetSize),
        keepRecentHours: keepHours
      }
    });

  } catch (error) {
    logger.error("Failed to cleanup old files:", error);
    res.status(500).json({ 
      error: "Failed to cleanup old files",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * GET /bucket/supported-types - Get list of supported file types for C2PA
 */
router.get("/supported-types", bucketLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { c2paService } = await import("../services/c2paService.js");
    const supportedTypes = c2paService.getSupportedTypes();
    
    // Group by category
    const categorizedTypes: Record<string, string[]> = {};
    
    supportedTypes.forEach((mimeType: string) => {
      let category = "other";
      if (mimeType.startsWith("image/")) category = "images";
      else if (mimeType.startsWith("video/")) category = "videos";
      else if (mimeType.startsWith("audio/")) category = "audio";
      else if (mimeType.startsWith("model/")) category = "3d-models";
      else if (mimeType.startsWith("application/") || mimeType.startsWith("text/")) category = "documents";
      else if (mimeType.startsWith("font/")) category = "fonts";
      
      if (!categorizedTypes[category]) {
        categorizedTypes[category] = [];
      }
      categorizedTypes[category].push(mimeType);
    });

    res.status(200).json({
      success: true,
      supportedTypes: categorizedTypes,
      totalTypes: supportedTypes.length,
      categories: Object.keys(categorizedTypes)
    });

  } catch (error) {
    logger.error("Failed to get supported file types:", error);
    res.status(500).json({ 
      error: "Failed to get supported file types",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * GET /bucket/check-type/:mimeType - Check if a specific file type is supported
 */
router.get("/check-type/:mimeType", bucketLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const { mimeType } = req.params;
    const { c2paService } = await import("../services/c2paService.js");
    
    const isSupported = c2paService.isSupported(mimeType);
    const fileTypeInfo = c2paService.getFileTypeInfo(mimeType);
    
    res.status(200).json({
      success: true,
      mimeType,
      isSupported,
      fileTypeInfo,
      category: isSupported ? c2paService.getFileCategory(mimeType) : null
    });

  } catch (error) {
    logger.error("Failed to check file type support:", error);
    res.status(500).json({ 
      error: "Failed to check file type support",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * POST /bucket/clear-cache - Clear bucket cache (admin only)
 */
router.post("/clear-cache", requireAuth as any, bucketLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const auth = (req as any).auth;
    if (!auth || !auth.sub) {
      res.status(401).json({ error: "User not authenticated" });
      return;
    }

    const userId = auth.sub;
    const storageDid = auth.mainDid;

    if (!storageDid) {
      res.status(400).json({ error: "No storage DID found for user" });
      return;
    }

    // Clear cache for this user
    bucketService.clearCache(storageDid);
    
    res.status(200).json({
      success: true,
      message: "Cache cleared successfully",
      userId,
      storageDid
    });

  } catch (error) {
    logger.error("Failed to clear cache:", error);
    res.status(500).json({ 
      error: "Failed to clear cache",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

export { router as bucketManagementRoutes };
