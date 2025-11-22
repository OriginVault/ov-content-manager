import { Router, Request, Response } from "express";
import { minioClient } from "../minio.js";
import logger from "../logger.js";

export function buildHealthRoutes(): Router {
  const router = Router();

  // Health check endpoint
  router.get("/health", async (req: Request, res: Response): Promise<void> => {
    try {
      // Check if SeaweedFS S3 is reachable
      await minioClient.bucketExists("test-bucket");
      
      res.json({ 
        message: "C2PA Modular Server is healthy and SeaweedFS is reachable",
        status: "healthy",
        timestamp: new Date().toISOString()
      });
      return;
    } catch (error) {
      logger.error("Health check failed: " + (error as Error).message);
      res.status(500).json({ 
        message: "C2PA Modular Server is healthy, but SeaweedFS is not reachable",
        status: "degraded",
        timestamp: new Date().toISOString()
      });
      return;
    }
  });

  // Detailed health check
  router.get("/health/detailed", async (req: Request, res: Response): Promise<void> => {
    try {
      const healthStatus = {
        server: "healthy",
        seaweedfs: "unknown"
      };

      // Test SeaweedFS connectivity
      try {
        await minioClient.bucketExists("test-bucket");
        healthStatus.seaweedfs = "healthy";
      } catch (error) {
        healthStatus.seaweedfs = "unhealthy";
        logger.error("SeaweedFS health check failed: " + (error as Error).message);
      }

      const overallStatus = healthStatus.seaweedfs === "healthy" ? "healthy" : "degraded";
      
      res.json({
        status: overallStatus,
        services: healthStatus,
        message: overallStatus === "healthy" 
          ? "All services are healthy" 
          : "Some services are degraded",
        timestamp: new Date().toISOString()
      });
      return;
    } catch (error) {
      logger.error("Detailed health check failed: " + (error as Error).message);
      res.status(500).json({ 
        status: "unhealthy",
        error: "Health check failed",
        timestamp: new Date().toISOString()
      });
      return;
    }
  });

  // Readiness probe
  router.get("/health/readiness", async (req: Request, res: Response): Promise<void> => {
    try {
      // Check if the service is ready to accept requests
      await minioClient.bucketExists("test-bucket");
      
      res.json({ 
        status: "ready",
        message: "Service is ready to accept requests",
        timestamp: new Date().toISOString()
      });
      return;
    } catch (error) {
      logger.error("Readiness check failed: " + (error as Error).message);
      res.status(503).json({ 
        status: "not_ready",
        error: "Service is not ready",
        timestamp: new Date().toISOString()
      });
      return;
    }
  });

  // Liveness probe
  router.get("/health/liveness", async (req: Request, res: Response): Promise<void> => {
    // Simple liveness check - just return OK if the service is running
    res.json({ 
      status: "alive",
      message: "Service is alive",
      timestamp: new Date().toISOString()
    });
  });

  return router;
}
