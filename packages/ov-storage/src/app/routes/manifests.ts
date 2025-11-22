import { Router, Request, Response } from "express";
import expressRateLimit from "express-rate-limit";
import { BUCKET, minioClient, streamToBuffer } from "../minio.js";
import { createC2paClient } from "@originvault/ov-c2pa";
import { requireAuth } from "../auth.js";
import logger from "../logger.js";

const signLimiter = expressRateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
}) as any;

export function buildManifestRoutes(): Router {
  const router = Router();

  // C2PA Signing Endpoint
  router.post("/sign", requireAuth as any, signLimiter, async (req: Request, res: Response): Promise<void> => {
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

      const client = createC2paClient();
      const { manifest } = await client.generateManifest(buffer, {
        title: "Test Manifest",
        fileName: fileId,
        fileSize: buffer.byteLength,
        mimeType: "image/jpeg",
        contentHash: "",
        snowflake: fileId,
        mnemonicId: fileId,
        uploadTime: new Date(),
      });

      const signed = await client.signFile(buffer, "image/jpeg", manifest);

      // Upload signed file securely
      const signedFileName = `signed-${fileId}`;
      const uploadUrl = await minioClient.presignedPutObject(BUCKET, signedFileName, 60);
      try {
        await fetch(uploadUrl, {
          method: "PUT",
          body: signed,
          headers: { "Content-Type": "image/jpeg" },
        }).then((response) => {
          if (response.ok && response.status === 200) {
            logger.info(`Signed file ${signedFileName} uploaded successfully`);
          } else {
            logger.error("Error uploading file: " + JSON.stringify(response.statusText));
            res.status(500).json({ error: "File upload failed: " + response.statusText });
            return;
          }
        });
      } catch (error) {
        logger.error("Error uploading file: " + (error as Error).message);
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
    } catch (error) {
      logger.error((error as Error).message);
      res.status(500).json({ error: "Signing failed" });
      return;
    }
  });

  // Webhook endpoint for C2PA signing server integration
  router.post("/webhooks/signing-completed", async (req: Request, res: Response): Promise<void> => {
    try {
      const webhook = req.body;
      const signature = req.headers['x-webhook-signature'] as string;

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
            await minioClient.putObject(
              BUCKET,
              identityPath,
              Buffer.from(JSON.stringify(metadata, null, 2)),
              undefined,
              { "Content-Type": "application/json" }
            );

            logger.info('File metadata updated with signing information', {
              fileId: webhook.fileId,
              manifestId: webhook.manifestId
            });
          } else {
            logger.warn('File metadata not found for webhook', { fileId: webhook.fileId });
          }
        } catch (error) {
          logger.error('Failed to update file metadata', { 
            fileId: webhook.fileId, 
            error: error instanceof Error ? error.message : String(error) 
          });
        }
      } else if (webhook.signatureStatus === 'failed') {
        logger.error('Signing failed for file', { 
          fileId: webhook.fileId, 
          error: webhook.error 
        });
      }

      res.status(200).json({ message: 'Webhook processed successfully' });
    } catch (error) {
      logger.error('Webhook processing failed', { 
        error: error instanceof Error ? error.message : String(error) 
      });
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // List all manifests
  router.get("/list-manifests", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
    const manifestList: any[] = [];
    try {
      const stream = minioClient.listObjectsV2(BUCKET, "manifests/", true);
      for await (const obj of stream as any) {
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
    } catch (e) {
      res.status(500).json({ error: "Error listing manifests" });
      return;
    }
  });

  // List public manifests
  router.get("/list-public-manifests", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
    const manifestList: any[] = [];
    try {
      const stream = minioClient.listObjectsV2(BUCKET, "public/manifests/", true);
      for await (const obj of stream as any) {
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
    } catch (e) {
      res.status(500).json({ error: "Error listing public manifests" });
      return;
    }
  });

  // Get manifest by ID
  router.get("/manifest/:manifestId", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
    const { manifestId } = req.params;
    try {
      const manifest = await minioClient.getObject(BUCKET, `manifests/${manifestId}`);
      const previewUrl = await minioClient.presignedGetObject(BUCKET, `manifests/${manifestId}`, 60);
      const manifestData = JSON.parse((await streamToBuffer(manifest)).toString());
      res.json({ manifest: manifestData, previewUrl });
      return;
    } catch (e) {
      res.status(404).json({ error: "Manifest not found" });
      return;
    }
  });

  // Get public manifest by ID
  router.get("/public-manifest/:manifestId", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
    const { manifestId } = req.params;
    try {
      const manifest = await minioClient.getObject(BUCKET, `public/manifests/${manifestId}`);
      const previewUrl = await minioClient.presignedGetObject(BUCKET, `public/manifests/${manifestId}`, 60);
      const manifestData = JSON.parse((await streamToBuffer(manifest)).toString());
      res.json({ manifest: manifestData, previewUrl });
      return;
    } catch (e) {
      res.status(404).json({ error: "Public manifest not found" });
      return;
    }
  });

  // List user manifests
  router.get("/list-user-manifests/:userDID", requireAuth as any, async (req: Request, res: Response): Promise<void> => {
    const { userDID } = req.params;
    const prefix = `users/${userDID}/manifests/`;
    const manifestList: any[] = [];
    try {
      const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
      for await (const obj of stream as any) {
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
    } catch (e) {
      res.status(500).json({ error: "Error listing user manifests" });
      return;
    }
  });

  return router;
}
