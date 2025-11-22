import { Router } from "express";
import { minioClient } from "../minio.js";
import { requireAuth } from "../auth.js";
import logger from "../logger.js";
export function buildBucketRoutes() {
    const router = Router();
    // Create bucket
    router.post("/create_bucket", requireAuth, async (req, res) => {
        const { bucketName } = req.body;
        if (!bucketName) {
            res.status(400).json({ error: "Missing bucketName" });
            return;
        }
        try {
            await minioClient.makeBucket(bucketName, "us-east-1");
            res.json({ message: `Bucket ${bucketName} created successfully` });
            return;
        }
        catch (error) {
            logger.error("Error creating bucket: " + error.message);
            res.status(500).json({ error: "Bucket creation failed" });
            return;
        }
    });
    // Check if bucket exists
    router.get("/bucket_exists", requireAuth, async (req, res) => {
        const { bucketName } = req.query;
        if (!bucketName || typeof bucketName !== 'string') {
            res.status(400).json({ error: "Missing bucketName query parameter" });
            return;
        }
        try {
            const exists = await minioClient.bucketExists(bucketName);
            res.json({ exists, bucketName });
            return;
        }
        catch (error) {
            logger.error("Error checking bucket existence: " + error.message);
            res.status(500).json({ error: "Bucket existence check failed" });
            return;
        }
    });
    // List all buckets
    router.get("/list_buckets", requireAuth, async (req, res) => {
        try {
            const buckets = await minioClient.listBuckets();
            res.json(buckets);
            return;
        }
        catch (error) {
            logger.error("Error listing buckets: " + error.message);
            res.status(500).json({ error: "Bucket listing failed" });
            return;
        }
    });
    // List files in a bucket
    router.get("/list_files/:bucketName", requireAuth, async (req, res) => {
        const { bucketName } = req.params;
        const { prefix = "", recursive = "true" } = req.query;
        try {
            const files = await minioClient.listObjects(bucketName, prefix, recursive === "true");
            const fileList = [];
            for await (const file of files) {
                fileList.push({
                    name: file.name,
                    size: file.size,
                    lastModified: file.lastModified,
                    etag: file.etag
                });
            }
            res.json(fileList);
            return;
        }
        catch (error) {
            logger.error("Error listing files: " + error.message);
            res.status(500).json({ error: "File listing failed" });
            return;
        }
    });
    // Request download URL
    router.post("/request-download-url", requireAuth, async (req, res) => {
        const { fileName, expires = 2000 } = req.body;
        if (!fileName) {
            res.status(400).json({ error: "Missing fileName" });
            return;
        }
        try {
            const downloadUrl = await minioClient.presignedGetObject(process.env.MINIO_BUCKET || "ov-content-manager-uploads", fileName, expires);
            res.json({ downloadUrl });
            return;
        }
        catch (error) {
            logger.error("Error getting presigned url: " + error.message);
            res.status(500).json({ error: "Presigned url retrieval failed" });
            return;
        }
    });
    // Get bucket statistics
    router.get("/bucket_stats/:bucketName", requireAuth, async (req, res) => {
        const { bucketName } = req.params;
        try {
            const objects = minioClient.listObjectsV2(bucketName, "", true);
            let totalSize = 0;
            let objectCount = 0;
            const fileTypes = {};
            for await (const obj of objects) {
                totalSize += obj.size;
                objectCount++;
                const extension = obj.name.split('.').pop()?.toLowerCase() || 'unknown';
                fileTypes[extension] = (fileTypes[extension] || 0) + 1;
            }
            res.json({
                bucketName,
                objectCount,
                totalSize,
                totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
                fileTypes
            });
            return;
        }
        catch (error) {
            logger.error("Error getting bucket stats: " + error.message);
            res.status(500).json({ error: "Bucket statistics retrieval failed" });
            return;
        }
    });
    // Delete bucket
    router.delete("/delete_bucket/:bucketName", requireAuth, async (req, res) => {
        const { bucketName } = req.params;
        try {
            // First, remove all objects in the bucket
            const objects = minioClient.listObjectsV2(bucketName, "", true);
            const objectNames = [];
            for await (const obj of objects) {
                objectNames.push(obj.name);
            }
            if (objectNames.length > 0) {
                await minioClient.removeObjects(bucketName, objectNames);
            }
            // Then remove the bucket
            await minioClient.removeBucket(bucketName);
            res.json({ message: `Bucket ${bucketName} deleted successfully` });
            return;
        }
        catch (error) {
            logger.error("Error deleting bucket: " + error.message);
            res.status(500).json({ error: "Bucket deletion failed" });
            return;
        }
    });
    // Get object metadata
    router.get("/object_metadata/:bucketName/*", requireAuth, async (req, res) => {
        const { bucketName } = req.params;
        const objectName = req.params[0]; // Get the wildcard parameter
        try {
            const stat = await minioClient.statObject(bucketName, objectName);
            res.json({
                bucketName,
                objectName,
                size: stat.size,
                lastModified: stat.lastModified,
                etag: stat.etag,
                contentType: stat.metaData?.["content-type"],
                metadata: stat.metaData
            });
            return;
        }
        catch (error) {
            logger.error("Error getting object metadata: " + error.message);
            res.status(404).json({ error: "Object not found" });
            return;
        }
    });
    // Copy object
    router.post("/copy_object", requireAuth, async (req, res) => {
        const { sourceBucket, sourceObject, destBucket, destObject } = req.body;
        if (!sourceBucket || !sourceObject || !destBucket || !destObject) {
            res.status(400).json({ error: "Missing required parameters" });
            return;
        }
        try {
            await minioClient.copyObject(destBucket, destObject, `${sourceBucket}/${sourceObject}`);
            res.json({
                message: "Object copied successfully",
                source: `${sourceBucket}/${sourceObject}`,
                destination: `${destBucket}/${destObject}`
            });
            return;
        }
        catch (error) {
            logger.error("Error copying object: " + error.message);
            res.status(500).json({ error: "Object copy failed" });
            return;
        }
    });
    return router;
}
