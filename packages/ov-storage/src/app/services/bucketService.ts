import { minioClient } from "../minio.js";
import logger from "../../logger.js";
import { loadConfig } from "../config.js";
import { redisService } from './redisService.js';

export interface BucketStats {
  totalSize: number;
  fileCount: number;
  fileTypes: Record<string, number>;
  lastUpdated: Date;
}

export interface QuotaInfo {
  userId: string;
  storageDid: string;
  currentUsage: number;
  maxQuota: number;
  usagePercentage: number;
  isOverQuota: boolean;
  files: Array<{
    key: string;
    size: number;
    lastModified: Date;
    mimeType: string;
  }>;
}

export interface QuotaCheckResult {
  allowed: boolean;
  currentUsage: number;
  maxQuota: number;
  usagePercentage: number;
  remainingQuota: number;
  error?: string;
}

export class BucketService {
  private minioClient: any;
  private bucketCache: Map<string, BucketStats> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds
  private readonly REDIS_CACHE_TTL = 300; // 5 minutes in seconds
  private config: any;

  constructor(minioClient: any) {
    this.minioClient = minioClient;
    this.config = loadConfig();
  }

  /**
   * Get bucket statistics for a user
   */
  async getBucketStats(storageDid: string): Promise<BucketStats> {
    const cacheKey = `bucket:stats:${storageDid}`;
    
    try {
      // Try Redis first
      const cached = await redisService.get(cacheKey);
      if (cached) {
        const stats = JSON.parse(cached) as BucketStats;
        logger.debug(`Bucket stats retrieved from Redis cache for ${storageDid}`);
        return stats;
      }
    } catch (error) {
      logger.warn('Redis cache miss, falling back to in-memory cache:', error);
    }

    // Fall back to in-memory cache
    const now = Date.now();
    const memoryCacheKey = `stats:${storageDid}`;
    if (this.bucketCache.has(memoryCacheKey)) {
      const expiry = this.cacheExpiry.get(memoryCacheKey) || 0;
      if (now < expiry) {
        logger.debug(`Bucket stats retrieved from in-memory cache for ${storageDid}`);
        return this.bucketCache.get(memoryCacheKey)!;
      }
    }

    try {
      const objects = this.minioClient.listObjects(
        this.config.minio.bucket,
        `users/${storageDid}/`,
        true
      );

      let totalSize = 0;
      let fileCount = 0;
      const fileTypes: Record<string, number> = {};

      for await (const obj of objects) {
        if (obj.name.endsWith("/")) continue; // Skip directories
        
        const stats = await this.minioClient.statObject(this.config.minio.bucket, obj.name);
        totalSize += stats.size;
        fileCount++;

        // Count file types
        const mimeType = stats.metaData?.["content-type"] || "application/octet-stream";
        const extension = this.getFileExtension(mimeType);
        fileTypes[extension] = (fileTypes[extension] || 0) + 1;
      }

      const stats: BucketStats = {
        totalSize,
        fileCount,
        fileTypes,
        lastUpdated: new Date()
      };

      // Store in both caches
      try {
        await redisService.setex(cacheKey, this.REDIS_CACHE_TTL, JSON.stringify(stats));
      } catch (error) {
        // Redis cache failure is not critical, just log and continue
        logger.debug('Failed to store in Redis cache (non-critical):', error);
      }
      
      this.bucketCache.set(memoryCacheKey, stats);
      this.cacheExpiry.set(memoryCacheKey, now + this.CACHE_TTL);

      logger.debug(`Bucket stats calculated and cached for ${storageDid}`);
      return stats;

    } catch (error) {
      logger.error(`Failed to get bucket stats for ${storageDid}:`, error);
      throw new Error(`Failed to get bucket statistics: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Check if a user can upload a file based on their quota
   */
  async checkUploadQuota(
    userId: string,
    storageDid: string,
    fileSize: number
  ): Promise<QuotaCheckResult> {
    try {
      const stats = await this.getBucketStats(storageDid);
      const maxQuota = this.config.user.maxBucketSizeGb * 1024 * 1024 * 1024; // Convert GB to bytes
      const currentUsage = stats.totalSize;
      const newUsage = currentUsage + fileSize;
      const usagePercentage = (newUsage / maxQuota) * 100;
      const remainingQuota = maxQuota - newUsage;

      const allowed = newUsage <= maxQuota;

      if (!allowed) {
        logger.warn(`Quota exceeded for user ${userId}: ${newUsage} bytes > ${maxQuota} bytes`);
      }

      return {
        allowed,
        currentUsage: newUsage,
        maxQuota,
        usagePercentage,
        remainingQuota
      };

    } catch (error) {
      logger.error(`Failed to check upload quota for user ${userId}:`, error);
      return {
        allowed: false,
        currentUsage: 0,
        maxQuota: 0,
        usagePercentage: 0,
        remainingQuota: 0,
        error: error instanceof Error ? error.message : "Unknown error"
      };
    }
  }

  /**
   * Get detailed quota information for a user
   */
  async getQuotaInfo(userId: string, storageDid: string): Promise<QuotaInfo> {
    try {
      const stats = await this.getBucketStats(storageDid);
      const maxQuota = this.config.user.maxBucketSizeGb * 1024 * 1024 * 1024;
      const usagePercentage = (stats.totalSize / maxQuota) * 100;
      const isOverQuota = stats.totalSize > maxQuota;

      // Get detailed file list
      const objects = this.minioClient.listObjects(
        this.config.minio.bucket,
        `users/${storageDid}/`,
        true
      );

      const files: QuotaInfo["files"] = [];
      for await (const obj of objects) {
        if (obj.name.endsWith("/")) continue;
        
        const stats = await this.minioClient.statObject(this.config.minio.bucket, obj.name);
        files.push({
          key: obj.name,
          size: stats.size,
          lastModified: stats.lastModified,
          mimeType: stats.metaData?.["content-type"] || "application/octet-stream"
        });
      }

      return {
        userId,
        storageDid,
        currentUsage: stats.totalSize,
        maxQuota,
        usagePercentage,
        isOverQuota,
        files
      };

    } catch (error) {
      logger.error(`Failed to get quota info for user ${userId}:`, error);
      throw new Error(`Failed to get quota information: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Clean up old files to free up space
   */
  async cleanupOldFiles(
    storageDid: string,
    targetSize: number,
    keepRecentHours: number = 24
  ): Promise<{ removedFiles: number; freedSpace: number }> {
    try {
      const stats = await this.getBucketStats(storageDid);
      if (stats.totalSize <= targetSize) {
        return { removedFiles: 0, freedSpace: 0 };
      }

      const objects = this.minioClient.listObjects(
        this.config.minio.bucket,
        `users/${storageDid}/`,
        true
      );

      const files: Array<{
        key: string;
        size: number;
        lastModified: Date;
      }> = [];

      for await (const obj of objects) {
        if (obj.name.endsWith("/")) continue;
        
        const stats = await this.minioClient.statObject(this.config.minio.bucket, obj.name);
        files.push({
          key: obj.name,
          size: stats.size,
          lastModified: stats.lastModified
        });
      }

      // Sort by last modified (oldest first)
      files.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime());

      const cutoffTime = Date.now() - (keepRecentHours * 60 * 60 * 1000);
      let removedFiles = 0;
      let freedSpace = 0;

      for (const file of files) {
        // Skip files modified within the keep period
        if (file.lastModified.getTime() > cutoffTime) {
          continue;
        }

        // Check if removing this file would get us under target
        if (stats.totalSize - freedSpace - file.size <= targetSize) {
          break;
        }

        try {
          await this.minioClient.removeObject(this.config.minio.bucket, file.key);
          removedFiles++;
          freedSpace += file.size;
          logger.info(`Removed old file ${file.key} to free up space`);
        } catch (error) {
          logger.error(`Failed to remove file ${file.key}:`, error);
        }
      }

      // Clear cache for this user
      this.clearCache(storageDid);

      return { removedFiles, freedSpace };

    } catch (error) {
      logger.error(`Failed to cleanup old files for ${storageDid}:`, error);
      throw new Error(`Failed to cleanup old files: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Get storage usage summary for all users
   */
  async getAllUsersUsage(): Promise<Array<{
    userId: string;
    storageDid: string;
    usage: number;
    maxQuota: number;
    usagePercentage: number;
    fileCount: number;
  }>> {
    try {
      const objects = this.minioClient.listObjects(this.config.minio.bucket, "users/", true);
      const userStats: Map<string, {
        userId: string;
        storageDid: string;
        usage: number;
        fileCount: number;
      }> = new Map();

      for await (const obj of objects) {
        if (obj.name.endsWith("/")) continue;
        
        const parts = obj.name.split("/");
        if (parts.length < 3) continue;

        const userId = parts[1];
        const storageDid = parts[2];
        const key = `${userId}:${storageDid}`;

        if (!userStats.has(key)) {
          userStats.set(key, {
            userId,
            storageDid,
            usage: 0,
            fileCount: 0
          });
        }

        const stats = await this.minioClient.statObject(this.config.minio.bucket, obj.name);
        const userStat = userStats.get(key)!;
        userStat.usage += stats.size;
        userStat.fileCount++;
      }

      const maxQuota = this.config.user.maxBucketSizeGb * 1024 * 1024 * 1024;
      
      return Array.from(userStats.values()).map(stat => ({
        ...stat,
        maxQuota,
        usagePercentage: (stat.usage / maxQuota) * 100
      }));

    } catch (error) {
      logger.error("Failed to get all users usage:", error);
      throw new Error(`Failed to get all users usage: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  /**
   * Clear cache for a specific user
   */
  async clearCache(storageDid?: string): Promise<void> {
    if (storageDid) {
      const cacheKey = `bucket:stats:${storageDid}`;
      try {
        await redisService.del(cacheKey);
      } catch (error) {
        // Redis cache failure is not critical, just log and continue
        logger.debug('Failed to clear Redis cache (non-critical):', error);
      }
      const memoryCacheKey = `stats:${storageDid}`;
      this.bucketCache.delete(memoryCacheKey);
      this.cacheExpiry.delete(memoryCacheKey);
      logger.debug(`Cache cleared for storage DID: ${storageDid}`);
    } else {
      // Clear all bucket stats from Redis
      try {
        const client = redisService.getClient();
        if (client) {
          const keys = await client.keys('bucket:stats:*');
          if (keys.length > 0) {
            await client.del(...keys);
          }
        }
      } catch (error) {
        // Redis cache failure is not critical, just log and continue
        logger.debug('Failed to clear all Redis cache (non-critical):', error);
      }
      this.bucketCache.clear();
      this.cacheExpiry.clear();
      logger.debug('All bucket cache cleared');
    }
  }

  /**
   * Clear all cache
   */
  async clearAllCache(): Promise<void> {
    await this.clearCache();
  }

  /**
   * Get file extension from MIME type
   */
  private getFileExtension(mimeType: string): string {
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "image/tiff": "tiff",
      "image/tif": "tif",
      "image/bmp": "bmp",
      "image/heic": "heic",
      "image/heif": "heif",
      "image/avif": "avif",
      "image/svg+xml": "svg",
      "video/mp4": "mp4",
      "video/quicktime": "mov",
      "video/x-msvideo": "avi",
      "video/x-ms-wmv": "wmv",
      "video/webm": "webm",
      "video/ogg": "ogv",
      "video/mpeg": "mpg",
      "video/x-matroska": "mkv",
      "audio/mpeg": "mp3",
      "audio/wav": "wav",
      "audio/ogg": "ogg",
      "audio/flac": "flac",
      "audio/aac": "aac",
      "audio/m4a": "m4a",
      "audio/webm": "webm",
      "application/pdf": "pdf",
      "application/msword": "doc",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
      "application/vnd.ms-excel": "xls",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
      "application/vnd.ms-powerpoint": "ppt",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
      "application/zip": "zip",
      "application/x-rar-compressed": "rar",
      "application/x-7z-compressed": "7z",
      "application/gzip": "gz",
      "application/x-tar": "tar",
      "text/plain": "txt",
      "text/html": "html",
      "text/css": "css",
      "text/javascript": "js",
      "application/json": "json",
      "application/xml": "xml",
      "text/markdown": "md",
      "font/woff": "woff",
      "font/woff2": "woff2",
      "font/ttf": "ttf",
      "font/otf": "otf"
    };

    return extensions[mimeType] || "bin";
  }

  /**
   * Format bytes to human readable string
   */
  formatBytes(bytes: number): string {
    if (bytes === 0) return "0 Bytes";
    
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }
}
