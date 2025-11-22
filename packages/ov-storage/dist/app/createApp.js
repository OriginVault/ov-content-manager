import express from "express";
import { strictCors, openCors } from "./cors.js";
import { buildFileRoutes } from "./routes/files.js";
import { buildManifestRoutes } from "./routes/manifests.js";
import { buildHealthRoutes } from "./routes/health.js";
import { buildBucketRoutes } from "./routes/buckets.js";
import anonymousRoutes from "./routes/anonymous.js";
import storageRoutes from "./routes/storage.js";
import { bucketManagementRoutes } from "./routes/bucketManagement.js";
import { redisService } from './services/redisService.js';
import { createUserRateLimit, createIPRateLimit, createUploadRateLimit } from './middleware/redisRateLimit.js';
import logger from '../logger.js';
export async function createApp() {
    // Initialize Redis connection (optional)
    await redisService.connect();
    // No need to log success/failure as RedisService handles this internally
    const app = express();
    app.use(express.json());
    app.use(strictCors);
    // Use Redis-based rate limiting if available, fallback to memory-based
    const userRateLimit = createUserRateLimit(100, 15 * 60 * 1000); // 100 requests per 15 minutes
    const ipRateLimit = createIPRateLimit(50, 15 * 60 * 1000); // 50 requests per 15 minutes
    const uploadRateLimit = createUploadRateLimit(10, 60 * 60 * 1000); // 10 uploads per hour
    // Apply rate limiting to routes
    app.use('/files', userRateLimit);
    app.use('/anonymous', ipRateLimit);
    app.use('/bucket', userRateLimit);
    app.use('/storage', userRateLimit);
    app.use('/manifests', userRateLimit);
    app.get("/", (req, res) => {
        res.json({ message: "C2PA Modular Server is running" });
    });
    // Whoami endpoint to return server and DID information
    app.get("/whoami", async (req, res) => {
        try {
            // Get the main DID from package.json
            const packageJson = JSON.parse(await import('fs').then(fs => fs.readFileSync('package.json', 'utf8')));
            const mainDid = packageJson.did;
            if (!mainDid) {
                res.status(500).json({
                    error: "Main DID not configured in package.json",
                    server: {
                        name: packageJson.name,
                        version: packageJson.version,
                        description: packageJson.description
                    }
                });
                return;
            }
            // Resolve the DID document using ov-id-sdk
            const { signingAgent } = await import("@originvault/ov-id-sdk");
            const didDocument = await signingAgent.resolve(mainDid);
            res.json({
                server: {
                    name: packageJson.name,
                    version: packageJson.version,
                    description: packageJson.description,
                    did: mainDid
                },
                didDocument: didDocument
            });
        }
        catch (error) {
            logger.error("Failed to get whoami information:", error);
            res.status(500).json({
                error: "Failed to resolve DID document",
                details: error instanceof Error ? error.message : "Unknown error"
            });
        }
    });
    // File management routes
    app.use("/files", openCors, buildFileRoutes());
    // Manifest and C2PA signing routes
    app.use("/manifests", openCors, buildManifestRoutes());
    // Health check routes (no auth required)
    app.use("", buildHealthRoutes());
    // Bucket management routes
    app.use("/buckets", openCors, buildBucketRoutes());
    // Enhanced bucket management routes (quota, stats, cleanup)
    app.use("/bucket", openCors, bucketManagementRoutes);
    // Anonymous upload routes (strict CORS for security)
    app.use("/anonymous", strictCors, anonymousRoutes);
    // DID-authenticated storage bucket APIs (open CORS + auth)
    app.use("/storage", openCors, storageRoutes);
    return app;
}
// Graceful shutdown
export async function shutdownApp() {
    try {
        await redisService.disconnect();
        logger.info('Redis service disconnected');
    }
    catch (error) {
        logger.error('Error disconnecting Redis service:', error);
    }
}
