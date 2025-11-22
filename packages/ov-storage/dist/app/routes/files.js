import { Router } from "express";
import expressRateLimit from "express-rate-limit";
import { BUCKET, minioClient, streamToBuffer } from "../minio.js";
import { computePerceptualHashes, computeSha256 } from "../hashing.js";
import { generateSnowflakeId, snowflakeToMnemonic, mnemonicToSnowflake } from "../ids.js";
import multer from "multer";
import { identityPathByContentHash } from "../identityStore.js";
import { writeIdentityAndMap } from "../writeIdentityAndMap.js";
import { buildPrivatePath, buildPublicPath } from "../keys.js";
import { requireAuth } from "../auth.js";
import { loadConfig } from "../config.js";
import { storageService } from "../services/storageService.js";
import logger from "../../logger.js";
import { c2paService } from "../services/c2paService.js";
import { BucketService } from "../services/bucketService.js";
const upload = multer({ storage: multer.memoryStorage() });
const config = loadConfig();
// Helper function to normalize keys
function normalizeKey(key) {
    return key.replace(/^\/+/, "").replace(/\/+$/, "");
}
export function buildFileRoutes() {
    const router = Router();
    const uploadLimiter = expressRateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        validate: { xForwardedForHeader: false },
    });
    router.post("/request-upload-url", requireAuth, uploadLimiter, async (req, res) => {
        const { userDID, contentHash, softPerceptualHash, mediumPerceptualHash, precisePerceptualHash, name } = req.body;
        if (!name || !userDID || !contentHash || !softPerceptualHash || !mediumPerceptualHash || !precisePerceptualHash) {
            res.status(400).json({ error: "Missing required fields" });
            return;
        }
        try {
            const identityPath = identityPathByContentHash(contentHash);
            const stat = await minioClient.statObject(BUCKET, identityPath).catch(() => null);
            if (stat) {
                const s = await minioClient.getObject(BUCKET, identityPath);
                const metadata = JSON.parse((await streamToBuffer(s)).toString());
                res.status(200).json({ message: "File already uploaded", existing: true, id: metadata.id, isOriginalOwner: metadata.userDID === userDID });
                return;
            }
            const fileId = generateSnowflakeId();
            const filePath = buildPrivatePath(userDID, name, fileId);
            const uploadUrl = await minioClient.presignedGetObject(BUCKET, filePath, 60);
            const mnemonicId = snowflakeToMnemonic(fileId);
            await writeIdentityAndMap({
                contentHash,
                softPerceptualHash,
                mediumPerceptualHash,
                precisePerceptualHash,
                userDID,
                fileName: name,
                id: fileId,
                path: filePath,
                publicPath: undefined,
                createdAt: new Date().toISOString(),
                status: "pending",
                mnemonicId
            });
            res.status(200).json({ uploadUrl, fileId });
            return;
        }
        catch (err) {
            res.status(500).json({ error: "Presigned url retrieval failed" });
            return;
        }
    });
    router.post("/upload", requireAuth, uploadLimiter, upload.single("file"), async (req, res) => {
        try {
            const file = req.file;
            const fileBuffer = file.buffer;
            const mimeType = file.mimetype;
            const contentHash = computeSha256(fileBuffer);
            const { softPerceptualHash, mediumPerceptualHash, precisePerceptualHash } = await computePerceptualHashes(fileBuffer);
            res.json({ message: "ok", contentHash, softPerceptualHash, mediumPerceptualHash, precisePerceptualHash, mimeType });
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Upload failed" });
            return;
        }
    });
    // Authenticated upload with storage DID creation
    router.post("/upload-authenticated", requireAuth, uploadLimiter, upload.single("file"), async (req, res) => {
        try {
            const file = req.file;
            if (!file) {
                res.status(400).json({ error: "No file provided" });
                return;
            }
            // Get user info from auth
            const auth = req.auth;
            if (!auth || !auth.sub) {
                res.status(401).json({ error: "User not authenticated" });
                return;
            }
            const userId = auth.sub;
            const mainDid = auth.mainDid;
            // Check file size limits
            const maxFileSize = config.user?.maxFileSizeMb || 100;
            const maxFileSizeBytes = maxFileSize * 1024 * 1024;
            if (file.size > maxFileSizeBytes) {
                res.status(413).json({
                    error: `File too large. Maximum size is ${maxFileSize}MB`
                });
                return;
            }
            // Generate snowflake ID and mnemonic
            const snowflake = generateSnowflakeId();
            const mnemonicId = snowflakeToMnemonic(snowflake);
            // Compute file hash
            const contentHash = await computeSha256(file.buffer);
            // Normalize filename
            const sanitizedName = normalizeKey(file.originalname || "file");
            // Check if user has storage DID, create if not
            let storageDid = await storageService.findUserStorageDid(userId);
            let isFirstUpload = false;
            if (!storageDid) {
                logger.info(`Creating storage DID for user: ${userId}`);
                storageDid = await storageService.createStorageDid(userId);
                isFirstUpload = true;
            }
            // Initialize bucket service for quota checking
            const bucketService = new BucketService(minioClient);
            // Check bucket quota before upload
            const quotaCheck = await bucketService.checkUploadQuota(userId, storageDid, file.size);
            if (!quotaCheck.allowed) {
                res.status(413).json({
                    error: `Storage quota exceeded. Current usage: ${bucketService.formatBytes(quotaCheck.currentUsage)}, Max quota: ${bucketService.formatBytes(quotaCheck.maxQuota)}`,
                    quotaInfo: {
                        currentUsage: quotaCheck.currentUsage,
                        maxQuota: quotaCheck.maxQuota,
                        usagePercentage: quotaCheck.usagePercentage,
                        remainingQuota: quotaCheck.remainingQuota
                    }
                });
                return;
            }
            // Store file in user bucket
            const fileKey = `users/${userId}/${mnemonicId}/${sanitizedName}`;
            await minioClient.putObject(config.minio.bucket, fileKey, file.buffer, file.size, {
                "Content-Type": file.mimetype,
                "x-amz-meta-snowflake": snowflake,
                "x-amz-meta-content-hash": contentHash,
                "x-amz-meta-user-id": userId,
                "x-amz-meta-storage-did": storageDid,
                "x-amz-meta-upload-time": new Date().toISOString(),
            });
            // Generate C2PA manifest for supported types using enhanced service
            let manifestKey = null;
            let manifestMnemonicId = null;
            try {
                if (c2paService.isSupported(file.mimetype)) {
                    const manifestResult = await c2paService.generateManifest(file.buffer, {
                        title: `Uploaded by ${userId}`,
                        userId,
                        fileName: sanitizedName,
                        fileSize: file.size,
                        mimeType: file.mimetype,
                        contentHash,
                        snowflake,
                        mnemonicId,
                        uploadTime: new Date(),
                        isAnonymous: false
                    });
                    if (manifestResult.success && manifestResult.manifest) {
                        manifestKey = manifestResult.manifestKey || null;
                        manifestMnemonicId = manifestResult.manifestMnemonicId || null;
                        // Store manifest if generated successfully
                        if (manifestKey) {
                            await minioClient.putObject(config.minio.bucket, manifestKey, Buffer.from(JSON.stringify(manifestResult.manifest)), JSON.stringify(manifestResult.manifest).length, {
                                "Content-Type": "application/json",
                                "x-amz-meta-snowflake": snowflake,
                                "x-amz-meta-user-id": userId,
                                "x-amz-meta-storage-did": storageDid,
                            });
                        }
                    }
                    else {
                        logger.warn(`Failed to generate C2PA manifest: ${manifestResult.error}`);
                    }
                }
            }
            catch (error) {
                logger.warn("Failed to generate C2PA manifest:", error);
            }
            // Publish Proof-of-Upload DLR
            let pouDidUrl = null;
            try {
                const pouResponse = await storageService.createProofOfUpload(storageDid, snowflake, mnemonicId, contentHash, sanitizedName, file.size, file.mimetype, "", // No IP hash for authenticated uploads
                manifestKey || undefined, manifestMnemonicId || undefined);
                pouDidUrl = pouResponse; // pouResponse is now the resourceId string
                logger.info(`Created Proof-of-Upload DLR: ${pouDidUrl}`);
            }
            catch (error) {
                logger.warn("Failed to create Proof-of-Upload DLR:", error);
            }
            res.status(200).json({
                storageDid,
                snowflake,
                mnemonicId,
                contentHash,
                fileName: sanitizedName,
                size: file.size,
                mimeType: file.mimetype,
                manifestKey,
                manifestMnemonicId,
                pouDidUrl,
                isFirstUpload,
                uploadTime: new Date().toISOString(),
            });
        }
        catch (error) {
            logger.error("Authenticated upload failed:", error);
            res.status(500).json({ error: "Upload failed" });
        }
    });
    // Claim storage DID ownership
    router.post("/claim-storage-did", requireAuth, async (req, res) => {
        try {
            const auth = req.auth;
            if (!auth || !auth.sub) {
                res.status(401).json({ error: "User not authenticated" });
                return;
            }
            const userId = auth.sub;
            const mainDid = auth.mainDid;
            if (!mainDid) {
                res.status(400).json({ error: "User must have a main DID to claim storage ownership" });
                return;
            }
            // Find user's storage DID
            const storageDid = await storageService.findUserStorageDid(userId);
            if (!storageDid) {
                res.status(404).json({ error: "No storage DID found for user" });
                return;
            }
            // TODO: Implement DID ownership transfer via cheqd-studio
            // This would require calling cheqd-studio to update the DID document
            // and set the user's main DID as the sole controller
            logger.info(`Storage DID ownership transfer requested for user ${userId}: ${storageDid}`);
            res.status(200).json({
                success: true,
                storageDid,
                message: "Storage DID ownership transfer initiated",
            });
        }
        catch (error) {
            logger.error("Claim storage DID failed:", error);
            res.status(500).json({ error: "Failed to claim storage DID" });
        }
    });
    // Identity preview by contentHash
    router.get("/identity/:contentHash", async (req, res) => {
        const { contentHash } = req.params;
        const identityPath = identityPathByContentHash(contentHash);
        try {
            const stat = await minioClient.statObject(BUCKET, identityPath).catch(() => null);
            if (!stat) {
                res.status(404).json({ error: "Identity not found" });
                return;
            }
            const stream = await minioClient.getObject(BUCKET, identityPath);
            const buffer = await streamToBuffer(stream);
            const metadata = JSON.parse(buffer.toString());
            res.json({ metadata });
            return;
        }
        catch (error) {
            res.status(500).json({ error: "Failed to fetch identity metadata" });
            return;
        }
    });
    // Check if a file is already uploaded (by contentHash or fileId)
    router.post("/check-file-uploaded", requireAuth, async (req, res) => {
        const { contentHash, fileId, userDID } = req.body;
        if (!contentHash && !fileId) {
            res.status(400).json({ error: "Missing either contentHash or fileId" });
            return;
        }
        const paths = {
            contentHash: identityPathByContentHash(contentHash || ""),
            id: `indexes/identities/${fileId}.json`
        };
        try {
            for (const path of Object.values(paths)) {
                if (!path.includes("undefined") && !path.endsWith("/.json")) {
                    const existing = await minioClient.statObject(BUCKET, path).catch(() => null);
                    if (existing) {
                        const stream = await minioClient.getObject(BUCKET, path);
                        const metadata = JSON.parse((await streamToBuffer(stream)).toString());
                        if (userDID && userDID !== metadata.userDID) {
                            res.status(200).json({ message: "This file is already uploaded by another user", existing: true, isOriginalOwner: false });
                            return;
                        }
                        else {
                            res.status(200).json({ message: "File already uploaded", existing: true, fileId: metadata.id, isOriginalOwner: userDID ? true : undefined });
                            return;
                        }
                    }
                }
            }
            res.status(200).json({ message: "File not uploaded", existing: false, id: null, isOriginalOwner: undefined });
            return;
        }
        catch (error) {
            res.status(500).json({ error: "Failed to check file uploaded" });
            return;
        }
    });
    // Public request upload URL (private and public paths)
    router.post("/request-public-upload-url", requireAuth, uploadLimiter, async (req, res) => {
        const { fileName, userDID, username, contentHash, softPerceptualHash, mediumPerceptualHash, precisePerceptualHash, color, colorCode } = req.body;
        if (!username) {
            res.status(400).json({ error: "Public files must have a username" });
            return;
        }
        if (!fileName || !userDID || !contentHash || !softPerceptualHash || !mediumPerceptualHash || !precisePerceptualHash) {
            res.status(400).json({ error: "Missing required fields" });
            return;
        }
        const identityPath = identityPathByContentHash(contentHash);
        try {
            const existing = await minioClient.statObject(BUCKET, identityPath).catch(() => null);
            if (existing) {
                const s = await minioClient.getObject(BUCKET, identityPath);
                const metadata = JSON.parse((await streamToBuffer(s)).toString());
                if (userDID !== metadata.userDID) {
                    res.status(200).json({ message: "This file is already uploaded by another user", existing: true });
                    return;
                }
                res.status(200).json({ message: "File already uploaded", existing: true, fileId: metadata.id });
                return;
            }
            const fileId = generateSnowflakeId();
            const privatePath = buildPrivatePath(userDID, fileName, fileId);
            const publicPath = buildPublicPath(username, fileId);
            const mnemonicId = snowflakeToMnemonic(fileId);
            const private_upload_url = await minioClient.presignedPutObject(BUCKET, privatePath, 60);
            const public_upload_url = await minioClient.presignedPutObject(BUCKET, publicPath, 60);
            await writeIdentityAndMap({
                contentHash,
                softPerceptualHash,
                mediumPerceptualHash,
                precisePerceptualHash,
                userDID,
                username,
                fileName,
                id: fileId,
                path: privatePath,
                publicPath,
                createdAt: new Date().toISOString(),
                status: "pending",
                color,
                colorCode,
                mnemonicId
            });
            res.status(200).json({ private_upload_url, public_upload_url, fileId });
            return;
        }
        catch (error) {
            res.status(500).json({ error: "Presigned url retrieval failed" });
            return;
        }
    });
    // Publish a previously private file under a username
    router.post("/publish-private-file", requireAuth, uploadLimiter, async (req, res) => {
        const { fileId, mnemonicId, userDID, username, fileName } = req.body;
        if (!fileId || !userDID || !username || !fileName) {
            res.status(400).json({ error: "Missing required fields" });
            return;
        }
        try {
            const privatePath = buildPrivatePath(userDID, fileName, fileId);
            const stat = await minioClient.statObject(BUCKET, privatePath).catch(() => null);
            if (!stat) {
                res.status(404).json({ error: "Private file not found" });
                return;
            }
            const s = await minioClient.getObject(BUCKET, privatePath);
            const buf = await streamToBuffer(s);
            const publicPath = buildPublicPath(username, fileId);
            await minioClient.putObject(BUCKET, publicPath, buf, stat.size, { "Content-Type": stat.metaData?.["content-type"] || "application/octet-stream" });
            // Minimal public file map entry (identity already references contentHash-indexed record)
            const publicFileMap = {
                id: fileId,
                name: fileName,
                path: publicPath,
                uploadedAt: new Date().toISOString(),
                isPublished: true,
                uri: `https://${username}.originvault.me/embeddable/${mnemonicId}`
            };
            const publicFileMapPath = `indexes/${username}/${fileId}.json`;
            await minioClient.putObject(BUCKET, publicFileMapPath, Buffer.from(JSON.stringify(publicFileMap)), undefined, { "Content-Type": "application/json" });
            const publicUrl = await minioClient.presignedGetObject(BUCKET, publicPath, 3600);
            res.status(200).json({ message: "File published successfully", id: fileId, name: fileName, path: publicPath, publicUrl, mnemonicId });
            return;
        }
        catch (error) {
            res.status(500).json({ error: "File publication failed" });
            return;
        }
    });
    // Get file by mnemonic (private)
    router.post("/get-file-by-mnemonic", requireAuth, async (req, res) => {
        const { mnemonic, userDID } = req.body;
        if (!mnemonic || !userDID) {
            res.status(400).json({ error: "Missing mnemonic or userDID" });
            return;
        }
        try {
            const fileId = mnemonicToSnowflake(mnemonic);
            const fileMapPath = `indexes/${userDID}/file_map/${fileId}.json`;
            const s = await minioClient.getObject(BUCKET, fileMapPath).catch(() => null);
            if (!s) {
                res.status(404).json({ error: "File map not found" });
                return;
            }
            const fileMapData = JSON.parse((await streamToBuffer(s)).toString());
            const downloadUrl = await minioClient.presignedGetObject(BUCKET, fileMapData.path, 60);
            res.json({ fileId, downloadUrl });
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Download URL generation failed" });
            return;
        }
    });
    // Get public file by mnemonic
    router.post("/get-public-file-by-mnemonic", requireAuth, async (req, res) => {
        const { mnemonic, username } = req.body;
        if (!mnemonic || !username) {
            res.status(400).json({ error: "Missing mnemonic or username" });
            return;
        }
        try {
            const fileId = mnemonicToSnowflake(mnemonic);
            const fileMapPath = `indexes/${username}/${fileId}.json`;
            const s = await minioClient.getObject(BUCKET, fileMapPath).catch(() => null);
            if (!s) {
                res.status(404).json({ error: "File map not found" });
                return;
            }
            const fileMapData = JSON.parse((await streamToBuffer(s)).toString());
            const downloadUrl = await minioClient.presignedGetObject(BUCKET, fileMapData.path, 60);
            res.json({ fileId, downloadUrl });
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Error getting public file by mnemonic" });
            return;
        }
    });
    // List all user files (private bucket)
    router.get("/list-user-files/:userDID", requireAuth, async (req, res) => {
        const { userDID } = req.params;
        const prefix = `users/${userDID}/`;
        const fileList = [];
        try {
            const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
            for await (const obj of stream) {
                const nameWithoutPrefix = obj.name.replace(prefix, "");
                const snowflakeId = nameWithoutPrefix.split("/").pop();
                const mnemonic = snowflakeToMnemonic(snowflakeId);
                const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60);
                fileList.push({
                    name: nameWithoutPrefix,
                    size: obj.size,
                    lastModified: obj.lastModified,
                    mnemonicId: mnemonic,
                    id: snowflakeId,
                    previewUrl,
                });
            }
            res.json(fileList);
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Error listing user files" });
            return;
        }
    });
    // List public files
    router.get("/list-public-files", requireAuth, async (req, res) => {
        const fileList = [];
        try {
            const stream = minioClient.listObjectsV2(BUCKET, "public/", true);
            for await (const obj of stream) {
                const nameWithoutPrefix = obj.name.replace("public/", "");
                const snowflakeId = nameWithoutPrefix.split("/").pop();
                const mnemonic = snowflakeToMnemonic(snowflakeId);
                const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60);
                fileList.push({
                    name: nameWithoutPrefix,
                    etag: obj.etag,
                    size: obj.size,
                    lastModified: obj.lastModified,
                    mnemonicId: mnemonic,
                    id: snowflakeId,
                    previewUrl
                });
            }
            res.json(fileList);
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Error listing public files" });
            return;
        }
    });
    // Delete uploaded file (and related metadata)
    router.delete("/delete-upload/:userDID/:fileId", requireAuth, async (req, res) => {
        const { userDID, fileId } = req.params;
        try {
            const prefix = `users/${userDID}/uploads/`;
            const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
            const objectsToDelete = [];
            for await (const obj of stream) {
                if (obj.name.includes(fileId))
                    objectsToDelete.push(obj.name);
            }
            if (objectsToDelete.length === 0) {
                res.status(404).json({ error: "File not found" });
                return;
            }
            objectsToDelete.push(`${userDID}/drafts/uploads/${fileId}`);
            objectsToDelete.push(`indexes/${userDID}/file_map/${fileId}.json`);
            await minioClient.removeObjects(BUCKET, objectsToDelete);
            res.json({ message: "Upload and related metadata deleted" });
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Deletion failed" });
            return;
        }
    });
    // Delete a user manifest
    router.delete("/delete-manifest/:userDID/:manifestId", requireAuth, async (req, res) => {
        const { userDID, manifestId } = req.params;
        const path = `users/${userDID}/manifests/${manifestId}`;
        try {
            await minioClient.removeObject(BUCKET, path);
            res.json({ message: "Manifest deleted successfully" });
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Manifest deletion failed" });
            return;
        }
    });
    // Delete a public manifest
    router.delete("/delete-public-manifest/:username/:manifestId", requireAuth, async (req, res) => {
        const { username, manifestId } = req.params;
        const path = `public/${username}/manifests/${manifestId}`;
        try {
            await minioClient.removeObject(BUCKET, path);
            res.json({ message: "Manifest deleted successfully" });
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Manifest deletion failed" });
            return;
        }
    });
    // List signed user files (files that have been registered by the user under their storage bucket DID)
    router.get("/list_signed_user_files", requireAuth, async (req, res) => {
        try {
            const auth = req.auth;
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
            const fileList = [];
            const prefix = `users/${userId}/`;
            try {
                const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
                for await (const obj of stream) {
                    // Skip directories and manifest files
                    if (obj.name.endsWith("/") || obj.name.includes("/manifests/")) {
                        continue;
                    }
                    const nameWithoutPrefix = obj.name.replace(prefix, "");
                    const snowflakeId = nameWithoutPrefix.split("/").pop();
                    const mnemonic = snowflakeToMnemonic(snowflakeId);
                    const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60);
                    // Check if file has a manifest (is signed)
                    const manifestPath = `users/${userId}/manifests/${snowflakeId}.json`;
                    let hasManifest = false;
                    try {
                        await minioClient.statObject(BUCKET, manifestPath);
                        hasManifest = true;
                    }
                    catch {
                        hasManifest = false;
                    }
                    fileList.push({
                        name: nameWithoutPrefix,
                        size: obj.size,
                        lastModified: obj.lastModified,
                        mnemonicId: mnemonic,
                        id: snowflakeId,
                        previewUrl,
                        hasManifest,
                        isSigned: hasManifest
                    });
                }
                res.json({
                    success: true,
                    files: fileList,
                    count: fileList.length,
                    userId,
                    storageDid
                });
                return;
            }
            catch (e) {
                res.status(500).json({ error: "Error listing signed user files" });
                return;
            }
        }
        catch (error) {
            logger.error("List signed user files failed:", error);
            res.status(500).json({ error: "Failed to list signed user files" });
            return;
        }
    });
    // Get user public files by username (different from /list-public-files, searches by specific username)
    router.get("/get_user_public_files/:username", requireAuth, async (req, res) => {
        const { username } = req.params;
        const fileList = [];
        try {
            const prefix = `public/${username}/`;
            const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
            for await (const obj of stream) {
                // Skip directories and manifest files
                if (obj.name.endsWith("/") || obj.name.includes("/manifests/")) {
                    continue;
                }
                const nameWithoutPrefix = obj.name.replace(prefix, "");
                const snowflakeId = nameWithoutPrefix.split("/").pop();
                const mnemonic = snowflakeToMnemonic(snowflakeId);
                const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60);
                // Check if file has a manifest
                const manifestPath = `public/${username}/manifests/${snowflakeId}.json`;
                let hasManifest = false;
                try {
                    await minioClient.statObject(BUCKET, manifestPath);
                    hasManifest = true;
                }
                catch {
                    hasManifest = false;
                }
                fileList.push({
                    name: nameWithoutPrefix,
                    etag: obj.etag,
                    size: obj.size,
                    lastModified: obj.lastModified,
                    mnemonicId: mnemonic,
                    id: snowflakeId,
                    previewUrl,
                    hasManifest,
                    isSigned: hasManifest,
                    username
                });
            }
            res.json({
                success: true,
                files: fileList,
                count: fileList.length,
                username
            });
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Error listing user public files" });
            return;
        }
    });
    // Get user upload count
    router.get("/user_upload_count/:userDID", requireAuth, async (req, res) => {
        const { userDID } = req.params;
        try {
            const prefix = `users/${userDID}/`;
            const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
            let fileCount = 0;
            let totalSize = 0;
            let signedCount = 0;
            for await (const obj of stream) {
                // Skip directories and manifest files for file count
                if (obj.name.endsWith("/")) {
                    continue;
                }
                if (!obj.name.includes("/manifests/")) {
                    fileCount++;
                    totalSize += obj.size;
                }
                else {
                    signedCount++;
                }
            }
            res.json({
                success: true,
                userDID,
                fileCount,
                signedCount,
                totalSize,
                totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100
            });
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Error getting user upload count" });
            return;
        }
    });
    // Get signed user file by userDID and fileId
    router.get("/get_signed_user_file/:userDID/:fileId", requireAuth, async (req, res) => {
        const { userDID, fileId } = req.params;
        try {
            const prefix = `users/${userDID}/`;
            const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
            for await (const obj of stream) {
                if (obj.name.includes(fileId) && !obj.name.endsWith("/") && !obj.name.includes("/manifests/")) {
                    const nameWithoutPrefix = obj.name.replace(prefix, "");
                    const mnemonic = snowflakeToMnemonic(fileId);
                    const downloadUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60);
                    // Check if file has a manifest
                    const manifestPath = `users/${userDID}/manifests/${fileId}.json`;
                    let manifest = null;
                    let hasManifest = false;
                    try {
                        const manifestStream = await minioClient.getObject(BUCKET, manifestPath);
                        const manifestBuffer = await streamToBuffer(manifestStream);
                        manifest = JSON.parse(manifestBuffer.toString());
                        hasManifest = true;
                    }
                    catch {
                        hasManifest = false;
                    }
                    res.json({
                        success: true,
                        file: {
                            name: nameWithoutPrefix,
                            size: obj.size,
                            lastModified: obj.lastModified,
                            mnemonicId: mnemonic,
                            id: fileId,
                            downloadUrl,
                            hasManifest,
                            isSigned: hasManifest,
                            manifest: hasManifest ? manifest : null
                        },
                        userDID
                    });
                    return;
                }
            }
            res.status(404).json({ error: "Signed user file not found" });
            return;
        }
        catch (e) {
            res.status(500).json({ error: "Error getting signed user file" });
            return;
        }
    });
    // Save user manifest draft (for users to add their own assertions)
    router.post("/save_user_manifest_draft", requireAuth, async (req, res) => {
        try {
            const auth = req.auth;
            if (!auth || !auth.sub) {
                res.status(401).json({ error: "User not authenticated" });
                return;
            }
            const { fileId, userDID, manifestData, draftName, description } = req.body;
            if (!fileId || !userDID || !manifestData) {
                res.status(400).json({ error: "Missing required fields: fileId, userDID, manifestData" });
                return;
            }
            const userId = auth.sub;
            // Verify user owns the file
            const filePrefix = `users/${userId}/`;
            const fileExists = minioClient.listObjectsV2(BUCKET, filePrefix, true);
            let userOwnsFile = false;
            for await (const obj of fileExists) {
                if (obj.name.includes(fileId) && !obj.name.endsWith("/") && !obj.name.includes("/manifests/")) {
                    userOwnsFile = true;
                    break;
                }
            }
            if (!userOwnsFile) {
                res.status(403).json({ error: "User does not own this file" });
                return;
            }
            // Generate draft ID
            const draftId = generateSnowflakeId();
            const draftPath = `users/${userId}/manifest-drafts/${draftId}.json`;
            const draftManifest = {
                id: draftId,
                fileId,
                userDID,
                userId,
                draftName: draftName || `Draft ${new Date().toISOString()}`,
                description: description || "",
                manifestData,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                status: "draft"
            };
            await minioClient.putObject(BUCKET, draftPath, Buffer.from(JSON.stringify(draftManifest, null, 2)), undefined, {
                "Content-Type": "application/json",
                "x-amz-meta-file-id": fileId,
                "x-amz-meta-user-id": userId,
                "x-amz-meta-draft-id": draftId
            });
            res.json({
                success: true,
                draftId,
                fileId,
                userDID,
                draftName: draftManifest.draftName,
                createdAt: draftManifest.createdAt,
                message: "Manifest draft saved successfully"
            });
            return;
        }
        catch (error) {
            logger.error("Save user manifest draft failed:", error);
            res.status(500).json({ error: "Failed to save manifest draft" });
            return;
        }
    });
    return router;
}
