import { Router } from "express";
import expressRateLimit from "express-rate-limit";
import { BUCKET, minioClient, streamToBuffer } from "../minio.js";
import { createC2pa, createTestSigner, ManifestBuilder } from "c2pa-node";
import { requireAuth } from "../auth.js";
import logger from "../logger.js";
const signLimiter = expressRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
});
export function buildManifestRoutes() {
    const router = Router();
    // C2PA Signing Endpoint
    router.post("/sign", requireAuth, signLimiter, async (req, res) => {
        try {
            const { fileId } = req.body;
            if (!fileId) {
                res.status(400).json({ error: "Missing fileId" });
                return;
            }
            // Use a presigned URL to securely fetch the file
            const presignedUrl = await minioClient.presignedGetObject(BUCKET, fileId, 60);
            const response = await fetch(presignedUrl);
            if (!response.body) {
                throw new Error("No response body");
            }
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            // Instantiate C2pa
            const c2pa = createC2pa();
            // Sign the file
            const signer = await createTestSigner();
            const asset = { buffer, mimeType: "image/jpeg" };
            // Provide the required arguments to ManifestBuilder
            const manifest = new ManifestBuilder({
                claim_generator: "ov-content-manager/1.0.0",
                format: "image/jpeg",
                title: "Test Manifest",
                assertions: [
                    {
                        label: "c2pa.actions",
                        data: {
                            actions: [
                                {
                                    action: "c2pa.unknown",
                                },
                            ],
                        },
                    },
                    {
                        label: "c2pa.cloud-data",
                        data: {
                            label: "com.custom.ballin",
                            size: 98765,
                            location: {
                                url: "https://resolver.originvault.box/1.0/identifiers/did:cheqd:mainnet:280dd37c-aa96-5e71-8548-5125505a968e/resources/b3612976-27bd-539e-99fc-c339e3a1be80",
                                alg: "sha256",
                                hash: "zP84FPSremIrAQHlhw+hRYQdZp/+KggnD0W8opXlIQQ=",
                            },
                            content_type: "application/octet-stream",
                            metadata: {
                                description: "Javascript executable",
                            },
                        },
                    },
                ],
            });
            const signedBuffer = await c2pa.sign({ asset, signer, manifest });
            // Upload signed file securely
            const signedFileName = `signed-${fileId}`;
            const uploadUrl = await minioClient.presignedPutObject(BUCKET, signedFileName, 60);
            try {
                await fetch(uploadUrl, {
                    method: "PUT",
                    body: signedBuffer.signedAsset.buffer,
                    headers: { "Content-Type": signedBuffer.signedAsset.mimeType },
                }).then((response) => {
                    if (response.ok && response.status === 200) {
                        logger.info(`Signed file ${signedFileName} uploaded successfully`);
                    }
                    else {
                        logger.error("Error uploading file: " + JSON.stringify(response.statusText));
                        res.status(500).json({ error: "File upload failed: " + response.statusText });
                        return;
                    }
                });
            }
            catch (error) {
                logger.error("Error uploading file: " + error.message);
                res.status(500).json({ error: "File upload failed" });
                return;
            }
            // Upload the manifest
            const manifestFileName = `manifests/${fileId}`;
            const manifestUploadUrl = await minioClient.presignedPutObject(BUCKET, manifestFileName, 60);
            await fetch(manifestUploadUrl, {
                method: "PUT",
                body: JSON.stringify(manifest.asSendable()),
                headers: { "Content-Type": "application/json" },
            }).then((response) => {
                if (response.ok && response.status === 200) {
                    logger.info(`Manifest ${manifestFileName} uploaded successfully`);
                }
            });
            res.json({
                message: "File signed successfully",
                signedFileName,
                manifestFileName,
                manifest: manifest.asSendable()
            });
            return;
        }
        catch (error) {
            logger.error(error.message);
            res.status(500).json({ error: "Signing failed" });
            return;
        }
    });
    // Webhook endpoint for C2PA signing server integration
    router.post("/webhooks/signing-completed", async (req, res) => {
        try {
            const webhook = req.body;
            const signature = req.headers['x-webhook-signature'];
            // Validate webhook signature (basic validation for now)
            if (!signature) {
                logger.warn('Webhook received without signature');
                res.status(400).json({ error: 'Missing webhook signature' });
                return;
            }
            // Log webhook data
            logger.info('Received signing completion webhook', {
                fileId: webhook.fileId,
                manifestId: webhook.manifestId,
                signatureStatus: webhook.signatureStatus,
                attestationId: webhook.attestationId,
                blockchainRegistrationId: webhook.blockchainRegistrationId,
                timestamp: webhook.timestamp
            });
            // Update file metadata with signing information
            if (webhook.signatureStatus === 'signed') {
                try {
                    // Find the file metadata and update it
                    const identityPath = `indexes/identities/${webhook.fileId}.json`;
                    const existing = await minioClient.statObject(BUCKET, identityPath).catch(() => null);
                    if (existing) {
                        const stream = await minioClient.getObject(BUCKET, identityPath);
                        const metadata = JSON.parse((await streamToBuffer(stream)).toString());
                        // Update metadata with signing information
                        metadata.signed = true;
                        metadata.manifestId = webhook.manifestId;
                        metadata.attestationId = webhook.attestationId;
                        metadata.blockchainRegistrationId = webhook.blockchainRegistrationId;
                        metadata.signedAt = webhook.timestamp;
                        metadata.signatureStatus = webhook.signatureStatus;
                        // Save updated metadata
                        await minioClient.putObject(BUCKET, identityPath, Buffer.from(JSON.stringify(metadata, null, 2)), undefined, { "Content-Type": "application/json" });
                        logger.info('File metadata updated with signing information', {
                            fileId: webhook.fileId,
                            manifestId: webhook.manifestId
                        });
                    }
                    else {
                        logger.warn('File metadata not found for webhook', { fileId: webhook.fileId });
                    }
                }
                catch (error) {
                    logger.error('Failed to update file metadata', {
                        fileId: webhook.fileId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }
            else if (webhook.signatureStatus === 'failed') {
                logger.error('Signing failed for file', {
                    fileId: webhook.fileId,
                    error: webhook.error
                });
            }
            res.status(200).json({ message: 'Webhook processed successfully' });
        }
        catch (error) {
            logger.error('Webhook processing failed', {
                error: error instanceof Error ? error.message : String(error)
            });
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    });
    // List all manifests
    router.get("/list-manifests", requireAuth, async (req, res) => {
        const manifestList = [];
        try {
            const stream = minioClient.listObjectsV2(BUCKET, "manifests/", true);
            for await (const obj of stream) {
                const nameWithoutPrefix = obj.name.replace("manifests/", "");
                const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60);
                manifestList.push({
                    name: nameWithoutPrefix,
                    etag: obj.etag,
                    size: obj.size,
                    lastModified: obj.lastModified,
                    previewUrl
                });
            }
            res.json(manifestList);
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Error listing manifests" });
            return;
        }
    });
    // List public manifests
    router.get("/list-public-manifests", requireAuth, async (req, res) => {
        const manifestList = [];
        try {
            const stream = minioClient.listObjectsV2(BUCKET, "public/manifests/", true);
            for await (const obj of stream) {
                const nameWithoutPrefix = obj.name.replace("public/manifests/", "");
                const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60);
                manifestList.push({
                    name: nameWithoutPrefix,
                    etag: obj.etag,
                    size: obj.size,
                    lastModified: obj.lastModified,
                    previewUrl
                });
            }
            res.json(manifestList);
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Error listing public manifests" });
            return;
        }
    });
    // Get manifest by ID
    router.get("/manifest/:manifestId", requireAuth, async (req, res) => {
        const { manifestId } = req.params;
        try {
            const manifest = await minioClient.getObject(BUCKET, `manifests/${manifestId}`);
            const previewUrl = await minioClient.presignedGetObject(BUCKET, `manifests/${manifestId}`, 60);
            const manifestData = JSON.parse((await streamToBuffer(manifest)).toString());
            res.json({ manifest: manifestData, previewUrl });
            return;
        }
        catch (e) {
            res.status(404).json({ error: "Manifest not found" });
            return;
        }
    });
    // Get public manifest by ID
    router.get("/public-manifest/:manifestId", requireAuth, async (req, res) => {
        const { manifestId } = req.params;
        try {
            const manifest = await minioClient.getObject(BUCKET, `public/manifests/${manifestId}`);
            const previewUrl = await minioClient.presignedGetObject(BUCKET, `public/manifests/${manifestId}`, 60);
            const manifestData = JSON.parse((await streamToBuffer(manifest)).toString());
            res.json({ manifest: manifestData, previewUrl });
            return;
        }
        catch (e) {
            res.status(404).json({ error: "Public manifest not found" });
            return;
        }
    });
    // List user manifests
    router.get("/list-user-manifests/:userDID", requireAuth, async (req, res) => {
        const { userDID } = req.params;
        const prefix = `users/${userDID}/manifests/`;
        const manifestList = [];
        try {
            const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
            for await (const obj of stream) {
                const nameWithoutPrefix = obj.name.replace(prefix, "");
                const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60);
                manifestList.push({
                    name: nameWithoutPrefix,
                    size: obj.size,
                    lastModified: obj.lastModified,
                    previewUrl,
                });
            }
            res.json(manifestList);
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Error listing user manifests" });
            return;
        }
    });
    return router;
}
