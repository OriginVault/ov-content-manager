import { loadConfig } from "../config.js";
import { minioClient } from "../minio.js";
import logger from "../../logger.js";

const config = loadConfig();

export class CleanupService {
  private minioClient = minioClient;
  private isRunning = false;
  private intervalId: NodeJS.Timeout | null = null;
  private cleanupTimer: NodeJS.Timeout | null = null;

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn("Cleanup service is already running");
      return;
    }

    logger.info("Starting anonymous upload cleanup service (will trigger on first upload)");
    this.isRunning = true;
  }

  // Trigger cleanup after upload (15 minutes delay)
  triggerCleanupAfterUpload(): void {
    if (!this.isRunning) {
      logger.warn("Cleanup service is not running");
      return;
    }

    // Clear any existing timer
    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
    }

    // Set timer for 15 minutes
    this.cleanupTimer = setTimeout(async () => {
      await this.performCleanup();
    }, 15 * 60 * 1000); // 15 minutes

    logger.debug("Cleanup scheduled for 15 minutes from now");
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info("Stopping anonymous upload cleanup service");
    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    if (this.cleanupTimer) {
      clearTimeout(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private async performCleanup(): Promise<void> {
    try {
      logger.info("Starting anonymous upload cleanup");
      
      const cutoffTime = new Date(Date.now() - config.anonymous.ttlHours * 60 * 60 * 1000);
      let deletedCount = 0;

      // Clean up anonymous uploads
      deletedCount += await this.cleanupAnonymousUploads(cutoffTime);
      
      // Clean up anonymous manifests
      deletedCount += await this.cleanupAnonymousManifests(cutoffTime);

      logger.info(`Cleanup completed. Deleted ${deletedCount} expired items`);
    } catch (error) {
      // Don't log as error if it's just a connection timeout - this is expected when MinIO isn't running
      if (error instanceof Error && (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED'))) {
        logger.debug("Cleanup skipped - storage service not available");
      } else {
        logger.error("Cleanup failed:", error);
      }
    }
  }

  private async cleanupAnonymousUploads(cutoffTime: Date): Promise<number> {
    let deletedCount = 0;
    
    try {
      const objects = this.minioClient.listObjects(config.minio.bucket, "anonymous/uploads/", true);
      
      for await (const obj of objects) {
        if (obj.name.endsWith("/")) continue; // Skip directories
        
        try {
          const stats = await this.minioClient.statObject(config.minio.bucket, obj.name);
          const uploadTime = stats.metaData?.["x-amz-meta-upload-time"];
          
          if (uploadTime) {
            const uploadDate = new Date(uploadTime);
            if (uploadDate < cutoffTime) {
              await this.minioClient.removeObject(config.minio.bucket, obj.name);
              deletedCount++;
              logger.debug(`Deleted expired upload: ${obj.name}`);
            }
          }
        } catch (error) {
          logger.warn(`Failed to process object ${obj.name}:`, error);
        }
      }
    } catch (error) {
      // Don't log as error if it's just a connection timeout
      if (error instanceof Error && (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED'))) {
        logger.debug("Anonymous uploads cleanup skipped - storage service not available");
      } else {
        logger.error("Failed to cleanup anonymous uploads:", error);
      }
    }
    
    return deletedCount;
  }

  private async cleanupAnonymousManifests(cutoffTime: Date): Promise<number> {
    let deletedCount = 0;
    
    try {
      const objects = this.minioClient.listObjects(config.minio.bucket, "anonymous/manifests/", true);
      
      for await (const obj of objects) {
        if (obj.name.endsWith("/")) continue; // Skip directories
        
        try {
          const stats = await this.minioClient.statObject(config.minio.bucket, obj.name);
          const uploadTime = stats.metaData?.["x-amz-meta-upload-time"];
          
          if (uploadTime) {
            const uploadDate = new Date(uploadTime);
            if (uploadDate < cutoffTime) {
              await this.minioClient.removeObject(config.minio.bucket, obj.name);
              deletedCount++;
              logger.debug(`Deleted expired manifest: ${obj.name}`);
            }
          }
        } catch (error) {
          logger.warn(`Failed to process manifest ${obj.name}:`, error);
        }
      }
    } catch (error) {
      // Don't log as error if it's just a connection timeout
      if (error instanceof Error && (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED'))) {
        logger.debug("Anonymous manifests cleanup skipped - storage service not available");
      } else {
        logger.error("Failed to cleanup anonymous manifests:", error);
      }
    }
    
    return deletedCount;
  }

  // Manual cleanup trigger for testing
  async triggerCleanup(): Promise<void> {
    if (!this.isRunning) {
      throw new Error("Cleanup service is not running");
    }
    
    await this.performCleanup();
  }
}

// Singleton instance
export const cleanupService = new CleanupService();
