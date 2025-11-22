import { Router } from "express";
import { minioClient } from "../minio.js";
import logger from "../logger.js";
export function buildHealthRoutes() {
    const router = Router();
    // Health check endpoint
    router.get("/health", async (req, res) => {
        try {
            // Check if MinIO is reachable
            await minioClient.bucketExists("test-bucket");
            res.json({
                message: "C2PA Modular Server is healthy and MinIO is reachable",
                status: "healthy",
                timestamp: new Date().toISOString()
            });
            return;
        }
        catch (error) {
            logger.error("Health check failed: " + error.message);
            res.status(500).json({
                message: "C2PA Modular Server is healthy, but MinIO is not reachable",
                status: "degraded",
                timestamp: new Date().toISOString()
            });
            return;
        }
    });
    // Detailed health check
    router.get("/health/detailed", async (req, res) => {
        try {
            const healthStatus = {
                server: "healthy",
                minio: "unknown"
            };
            // Test MinIO connectivity
            try {
                await minioClient.bucketExists("test-bucket");
                healthStatus.minio = "healthy";
            }
            catch (error) {
                healthStatus.minio = "unhealthy";
                logger.error("MinIO health check failed: " + error.message);
            }
            const overallStatus = healthStatus.minio === "healthy" ? "healthy" : "degraded";
            res.json({
                status: overallStatus,
                services: healthStatus,
                message: overallStatus === "healthy"
                    ? "All services are healthy"
                    : "Some services are degraded",
                timestamp: new Date().toISOString()
            });
            return;
        }
        catch (error) {
            logger.error("Detailed health check failed: " + error.message);
            res.status(500).json({
                status: "unhealthy",
                error: "Health check failed",
                timestamp: new Date().toISOString()
            });
            return;
        }
    });
    // Readiness probe
    router.get("/health/readiness", async (req, res) => {
        try {
            // Check if the service is ready to accept requests
            await minioClient.bucketExists("test-bucket");
            res.json({
                status: "ready",
                message: "Service is ready to accept requests",
                timestamp: new Date().toISOString()
            });
            return;
        }
        catch (error) {
            logger.error("Readiness check failed: " + error.message);
            res.status(503).json({
                status: "not_ready",
                error: "Service is not ready",
                timestamp: new Date().toISOString()
            });
            return;
        }
    });
    // Liveness probe
    router.get("/health/liveness", async (req, res) => {
        // Simple liveness check - just return OK if the service is running
        res.json({
            status: "alive",
            message: "Service is alive",
            timestamp: new Date().toISOString()
        });
    });
    return router;
}
