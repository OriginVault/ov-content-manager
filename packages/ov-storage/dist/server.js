import { createC2pa, createTestSigner, ManifestBuilder } from "c2pa-node";
import { getPrimaryDID, signVC, createResource, parentAgent, parentStore } from "@originvault/ov-id-sdk";
import logger from "./logger.js";
import * as Minio from "minio";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import expressRateLimit from "express-rate-limit";
import { generateSnowflakeId, mnemonicToSnowflake, snowflakeToMnemonic } from "./generateSnowflakeId.js";
import { co2 } from "@tgwf/co2";
import blockhash from 'blockhash-core';
import { v4 as uuidv4 } from 'uuid';
import { Jimp, ResizeStrategy } from 'jimp';
import crypto from "crypto";
dotenv.config();
let signingDid = null;
let signingAgent = parentAgent;
let provider = null;
let keys = null;
function initializeAgent() {
    console.log('Starting agent initialization...');
    parentStore.initialize({
        payerSeed: process.env.COSMOS_PAYER_SEED,
        didRecoveryPhrase: process.env.PARENT_DID_RECOVERY_PHRASE
    })
        .then((initializedAgent) => {
        console.log('Agent initialized successfully.');
        const { agent, did, cheqdMainnetProvider, privateKeyStore } = initializedAgent;
        signingDid = did;
        signingAgent = agent;
        provider = cheqdMainnetProvider;
        keys = privateKeyStore;
        console.log('signingDid', signingDid);
        console.log('signingAgent', signingAgent);
        console.log('provider', provider);
        console.log('keys', keys);
    })
        .catch((error) => {
        console.error('Error initializing agent:', error);
    });
}
setTimeout(initializeAgent, 0);
const hashFile = async (fileBuffer) => {
    const hashBuffer = await crypto.subtle.digest('SHA-256', fileBuffer);
    // Convert the ArrayBuffer into a hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
};
function djb2(str) {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i); /* hash * 33 + c */
    }
    return hash;
}
function hashStringToColor(str) {
    const hash = djb2(str);
    const r = (hash >> 16) & 0xFF;
    const g = (hash >> 8) & 0xFF;
    const b = hash & 0xFF;
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
const getFragmentedFile = async (fileBuffer) => {
    const image = await Jimp.read(Buffer.from(fileBuffer));
    const height = 800 / image.width * image.height;
    image.resize({ w: 800, h: height, mode: ResizeStrategy.BILINEAR })
        .normalize();
    const normalizedBuffer = await image.getBuffer("image/jpeg");
    const file = new File([normalizedBuffer], "file.jpg", { type: "image/jpg" });
    const fragmentCount = 24; // Set the number of fragments to 24
    const fragmentSize = Math.ceil(file.size / fragmentCount); // Calculate fragment size
    const fragments = [];
    for (let i = 0; i < file.size; i += fragmentSize) {
        const fragment = file.slice(i, i + fragmentSize);
        fragments.push({ blob: fragment, name: `fragment-${i}` });
    }
    return fragments;
};
const getColorFragments = async (fileBuffer, fragments) => {
    const colorFragments = [];
    for (const { blob } of fragments) {
        const hash = await hashFile(await blob.arrayBuffer());
        const color = hashStringToColor(hash);
        colorFragments.push(color);
    }
    return colorFragments;
};
// 🆕 NEW: Simple Hamming distance for "duplicate" checks
function hammingDistance(a, b) {
    if (!a || !b || a.length !== b.length)
        return Infinity;
    let dist = 0;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            dist++;
    }
    return dist;
}
const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || "seaweed",
    port: parseInt(process.env.MINIO_PORT || "8333"),
    accessKey: process.env.MINIO_ROOT_USER || "minioadmin",
    secretKey: process.env.MINIO_ROOT_PASSWORD || "minioadmin",
    useSSL: (process.env.MINIO_USE_SSL || "false").toLowerCase() === "true"
});
const app = express();
app.use(express.json());
app.use(cors({
    origin: (origin, callback) => {
        if (process.env.NODE_ENV === 'development') {
            return callback(null, true);
        }
        if (!origin)
            return callback(null, true); // Allow non-browser requests (like curl/postman)
        const allowedPattern = /\.?originvault\.(me|co)$/;
        try {
            const { hostname } = new URL(origin);
            if (allowedPattern.test(hostname)) {
                return callback(null, true);
            }
        }
        catch (err) {
            return callback(new Error('Invalid origin format'));
        }
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
const BUCKET = process.env.MINIO_BUCKET || "ov-content-manager-uploads";
// In-memory store for presigned URLs
const urlStore = {};
// Middleware to clean up expired URLs
setInterval(() => {
    const now = Date.now();
    for (const key in urlStore) {
        if (urlStore[key].expiresAt < now) {
            delete urlStore[key];
        }
    }
}, 60000); // Check every minute
// Helper: Convert MinIO Stream to Buffer
function streamToBuffer(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on("data", (chunk) => chunks.push(chunk));
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", reject);
    });
}
function normalizeKey(did, name, revision) {
    const safeDid = did.replace(/[:]/g, "_"); // turn `did:key:xyz` → `did_key_xyz`
    const safeName = name.replace(/[^a-zA-Z0-9.\-_]/g, "_"); // file-safe
    return `users/${safeDid}/uploads/${safeName}/${revision}`;
}
// Set up rate limiting
const limiter = expressRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5000,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
});
// Apply the rate limiting middleware to all requests
app.use(limiter);
// Create a specific rate limiter for upload-related routes
const uploadLimiter = expressRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
});
export async function createContentRegistration(record, mnemonicId) {
    const resourceId = uuidv4();
    const resourceName = `content-registration-${mnemonicId}`.substring(0, 64);
    console.log("signingDid", signingDid);
    console.log("signingAgent", signingAgent);
    try {
        const result = await createResource({
            data: record,
            did: signingDid,
            name: resourceName,
            provider,
            agent: signingAgent,
            keyStore: keys,
            resourceId: resourceId,
            resourceType: 'Content-Registration-Record',
            version: Math.floor(Date.now() / 1000)
        });
        return result;
    }
    catch (error) {
        logger.error("Error creating content registration: " + error.message);
        return null;
    }
}
// 🆕 NEW: Write identity + file map to MinIO in one place.
async function writeIdentityAndMap({ contentHash, softPerceptualHash, mediumPerceptualHash, precisePerceptualHash, userDID, username, fileName, id, path, color, colorCode, mnemonicId, publicPath }) {
    const identityPath = `indexes/identities/${contentHash}.json`;
    const uploadedAt = new Date().toISOString();
    // Identity record
    const identityData = {
        contentHash,
        softPerceptualHash,
        mediumPerceptualHash,
        precisePerceptualHash,
        userDID,
        username, // only relevant for public files
        id,
        fileName,
        path,
        createdAt: uploadedAt,
        status: "pending",
        color,
        colorCode,
        mnemonicId
    };
    await minioClient.putObject(BUCKET, identityPath, Buffer.from(JSON.stringify(identityData)), undefined, { "Content-Type": "application/json" });
    // File map record
    const fileMapData = {
        id,
        fileName,
        path,
        publicPath,
        uploadedAt,
        identityRef: identityPath,
    };
    try {
        const result = await createContentRegistration(identityData, mnemonicId);
        console.log("Content registration created:", result);
    }
    catch (error) {
        logger.error("Error creating content registration: " + error.message);
        return null;
    }
    // If it's a public file => store in indexes/<username>/<fileId>.json
    // Else => store in indexes/<userDID>/file_map/<fileId>.json
    const indexBase = username ? `indexes/${username}` : `indexes/${userDID}/file_map`;
    const fileMapPath = username ? `${indexBase}/${id}.json` : `${indexBase}/${id}.json`;
    await minioClient.putObject(BUCKET, fileMapPath, Buffer.from(JSON.stringify(fileMapData)), undefined, { "Content-Type": "application/json" });
    return { identityPath, fileMapPath };
}
/** Reproduces the front-end's file hashing: SHA-256 hex. */
function computeSha256(buffer) {
    return crypto.createHash("sha256").update(buffer).digest("hex");
}
/**
 * Reproduce the same 3 perceptual hashes that the front end does (8 / 16 / 24).
 * Following the same approach: resize to 800 wide (maintaining aspect),
 * optionally `.normalize()`, then run blockhash bmvbhash.
 */
async function computePerceptualHashes(buffer) {
    const image = await Jimp.read(Buffer.from(buffer));
    const height = 800 / image.width * image.height;
    image.resize({ w: 800, h: height, mode: ResizeStrategy.BILINEAR })
        .normalize();
    // normalize
    image.normalize();
    // Now convert Jimp => RGBA image data for blockhash
    const { data, width: w, height: h } = image.bitmap;
    // blockhash.bmvbhash expects an ImageData-like object
    async function getHash(degree) {
        return blockhash.bmvbhash({ data, width: w, height: h }, degree);
    }
    const softPerceptualHash = await getHash(8);
    const mediumPerceptualHash = await getHash(16);
    const precisePerceptualHash = await getHash(24);
    return { softPerceptualHash, mediumPerceptualHash, precisePerceptualHash };
}
/**
 * Optional example: compute CO2 footprint in grams for the uploaded file
 * (the same as front end's co2Emission.perByte(...)).
 */
function computeCarbonFootprint(byteLength) {
    const co2Calc = new co2();
    return co2Calc.perByte(byteLength, true);
}
// multer for file uploads
const upload = multer({ storage: multer.memoryStorage() }); // Store files in memory
// 🆕 NEW: PREVIEW ENDPOINT — get public identity by contentHash
app.get("/identity/:contentHash", async (req, res) => {
    const { contentHash } = req.params;
    const identityPath = `indexes/identities/${contentHash}.json`;
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
        logger.error("Error fetching identity: " + error.message);
        res.status(500).json({ error: "Failed to fetch identity metadata" });
        return;
    }
});
/**
 * =============
 *  ROUTES
 * =============
 */
// check if a file is already uploaded
app.post("/check-file-uploaded", async (req, res) => {
    const { contentHash, fileId, userDID } = req.body;
    if (!contentHash && !fileId) {
        res.status(400).json({ error: "Missing either contentHash or fileId" });
        return;
    }
    const paths = {
        contentHash: `indexes/identities/${contentHash}.json`,
        id: `indexes/identities/${fileId}.json`
    };
    try {
        for (const path of Object.values(paths)) {
            const existing = await minioClient.statObject(BUCKET, path).catch(() => null);
            if (existing) {
                const stream = await minioClient.getObject(BUCKET, path);
                const metadata = JSON.parse((await streamToBuffer(stream)).toString());
                if (userDID !== metadata.userDID) {
                    res.status(200).json({ message: "This file is already uploaded by another user", existing: true, isOriginalOwner: false });
                    return;
                }
                else {
                    res.status(200).json({ message: "File already uploaded", existing: true, fileId: metadata.id, isOriginalOwner: true });
                    return;
                }
            }
        }
        res.status(200).json({ message: "File not uploaded", existing: false, id: null, isOriginalOwner: undefined });
        return;
    }
    catch (error) {
        logger.error("Error checking file uploaded: " + error.message);
        res.status(500).json({ error: "Failed to check file uploaded" });
        return;
    }
});
// ✅ Updated "request-upload-url" (private) — can remain as-is or rely on client's claims for now
app.post("/request-upload-url", uploadLimiter, async (req, res) => {
    const { userDID, contentHash, softPerceptualHash, mediumPerceptualHash, precisePerceptualHash, color, colorCode, name } = req.body;
    if (!name || !userDID || !contentHash || !softPerceptualHash || !mediumPerceptualHash || !precisePerceptualHash) {
        res.status(400).json({ error: "Missing required fields" });
        return;
    }
    const identityPath = `indexes/identities/${contentHash}.json`;
    try {
        const existing = await minioClient.statObject(BUCKET, identityPath).catch(() => null);
        let uploadCount = 0;
        if (existing) {
            const stream = await minioClient.getObject(BUCKET, identityPath);
            const metadata = JSON.parse((await streamToBuffer(stream)).toString());
            uploadCount = metadata.uploadCount || 0;
            uploadCount += 1;
            metadata.uploadCount = uploadCount;
            await minioClient.putObject(BUCKET, identityPath, Buffer.from(JSON.stringify(metadata)), undefined, { "Content-Type": "application/json" });
            // Exclude sensitive information from the response
            const { userDID: existinguserDID, id } = metadata;
            if (userDID !== existinguserDID) {
                res.status(200).json({ message: "This file is already uploaded by another user", existing: true, isOriginalOwner: false });
                return;
            }
            res.status(200).json({ message: "File already uploaded", existing: true, id, isOriginalOwner: true });
            return;
        }
        // Basic user upload limit
        const prefix = `users/${userDID}/uploads/`;
        const listStream = minioClient.listObjectsV2(BUCKET, prefix, true);
        let count = 0;
        for await (const _ of listStream)
            count++;
        if (count >= 10) {
            res.status(403).json({ error: "Upload limit reached (max 10 files)" });
            return;
        }
        const fileId = generateSnowflakeId();
        const filePath = `users/${userDID}/uploads/${name}/${fileId}`;
        const uploadUrl = await minioClient.presignedGetObject(BUCKET, filePath, 60); // expires in 60s
        const mnemonicId = snowflakeToMnemonic(fileId);
        // We create identity & map, but they're still "unverified" until the real file arrives
        await writeIdentityAndMap({
            contentHash,
            softPerceptualHash,
            mediumPerceptualHash,
            precisePerceptualHash,
            userDID: userDID,
            fileName: name,
            id: fileId,
            path: filePath,
            color,
            colorCode,
            mnemonicId
        });
        console.log('uploadUrl', uploadUrl);
        res.status(200).json({ uploadUrl, fileId });
        return;
    }
    catch (error) {
        logger.error("Error getting presigned url: " + error.message);
        res.status(500).json({ error: "Presigned url retrieval failed" });
        return;
    }
});
// ✅ Updated "request-public-upload-url" — similar pattern, but for public
app.post("/request-public-upload-url", uploadLimiter, async (req, res) => {
    const { fileName, userDID, username, contentHash, softPerceptualHash, mediumPerceptualHash, precisePerceptualHash, color, colorCode } = req.body;
    if (!username) {
        res.status(400).json({ error: "Public files must have a username" });
        return;
    }
    if (!fileName || !userDID || !contentHash || !softPerceptualHash || !mediumPerceptualHash || !precisePerceptualHash) {
        res.status(400).json({ error: "Missing required fields" });
        return;
    }
    const identityPath = `indexes/identities/${contentHash}.json`;
    try {
        const existing = await minioClient.statObject(BUCKET, identityPath).catch(() => null);
        let uploadCount = 0;
        if (existing) {
            const stream = await minioClient.getObject(BUCKET, identityPath);
            const metadata = JSON.parse((await streamToBuffer(stream)).toString());
            uploadCount = metadata.uploadCount || 0;
            uploadCount += 1;
            metadata.uploadCount = uploadCount;
            await minioClient.putObject(BUCKET, identityPath, Buffer.from(JSON.stringify(metadata)), undefined, { "Content-Type": "application/json" });
            // Exclude sensitive information from the response
            const { userDID: existingUserDID, username: __, fileId: existingFileId } = metadata;
            if (userDID !== existingUserDID) {
                res.status(200).json({ message: "This file is already uploaded by another user", existing: true, });
                return;
            }
            res.status(200).json({ message: "File already uploaded", existing: true, fileId: existingFileId });
            return;
        }
        const fileId = generateSnowflakeId();
        const privatePath = `users/${userDID}/uploads/${fileName}/${fileId}`;
        const publicPath = `public/${username}/${fileId}`;
        const mnemonicId = snowflakeToMnemonic(fileId);
        // For public usage, we give them both private & public presigned URLs
        const private_upload_url = await minioClient.presignedPutObject(BUCKET, normalizeKey(userDID, fileName, fileId), 60);
        const public_upload_url = await minioClient.presignedPutObject(BUCKET, normalizeKey(username, fileName, fileId), 60);
        // Just store the identity + map with the final public path
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
            color,
            colorCode,
            mnemonicId
        });
        res.status(200).json({ private_upload_url, public_upload_url, fileId });
        return;
    }
    catch (error) {
        logger.error("Error getting public presigned url: " + error.message);
        res.status(500).json({ error: "Presigned url retrieval failed" });
        return;
    }
});
// 🆕 UPDATED: Real server-side "upload" route that verifies the file's identity
app.post("/upload/:uri", uploadLimiter, upload.single("file"), async (req, res) => {
    const { uri } = req.params;
    const entry = urlStore[uri];
    if (!entry) {
        res.status(404).json({ error: "Upload URL not found or expired" });
        return;
    }
    try {
        // 1) Get the uploaded buffer
        const file = req.file;
        const fragments = await getFragmentedFile(file.buffer);
        const fileBuffer = file.buffer;
        const mimeType = file.mimetype;
        const c2pa = createC2pa();
        const manifest = await c2pa.read({ buffer: fileBuffer, mimeType: mimeType });
        const claims = manifest?.claims;
        console.log("claims", manifest, claims);
        const color = hashStringToColor(file.name);
        const colorFragments = await getColorFragments(fileBuffer, fragments);
        const colorCode = colorFragments.map((color) => color.replace('#', '-')).join('');
        const colorCodeWithoutLeadingDash = colorCode.slice(1);
        // 2) Compute the real contentHash (SHA-256) from the buffer
        const contentHash = computeSha256(fileBuffer);
        // 3) Compute the 3 perceptual hashes from the buffer
        const { softPerceptualHash, mediumPerceptualHash, precisePerceptualHash } = await computePerceptualHashes(fileBuffer);
        // 4) (Optional) Log CO2 footprint
        const carbonFootprint = computeCarbonFootprint(fileBuffer.byteLength);
        // 5) Check for existing identity with the same contentHash
        const identityPath = `indexes/identities/${contentHash}.json`;
        let existingMetadata = null;
        const identityStat = await minioClient.statObject(BUCKET, identityPath).catch(() => null);
        if (identityStat) {
            // If identity already exists, we can read it
            const stream = await minioClient.getObject(BUCKET, identityPath);
            existingMetadata = JSON.parse((await streamToBuffer(stream)).toString());
        }
        // 6) Potential duplicates search by scanning all identities (expensive for large sets)
        const allIdentities = minioClient.listObjectsV2(BUCKET, "indexes/identities/", true);
        for await (const obj of allIdentities) {
            if (!obj.name.endsWith(".json"))
                continue;
            // read + parse
            const s = await minioClient.getObject(BUCKET, obj.name);
            const buf = await streamToBuffer(s);
            const record = JSON.parse(buf.toString());
            const mediumDist = hammingDistance(mediumPerceptualHash, record.mediumPerceptualHash);
            const preciseDist = hammingDistance(precisePerceptualHash, record.precisePerceptualHash);
            if (mediumDist <= 5 || preciseDist <= 8) {
                logger.warn(`⚠️ Potential duplicate:
           newFile => contentHash:${contentHash}, mediumHash:${mediumPerceptualHash}, preciseHash:${precisePerceptualHash}
           existing => fileId:${record.id}, userDID:${record.userDID}, fileName:${record.fileName}
           distances => medium:${mediumDist}, precise:${preciseDist}`);
            }
        }
        // Retrieve expected identity data
        const expectedContentHash = entry.expectedContentHash;
        const expectedSoftPerceptualHash = entry.expectedSoftPerceptualHash;
        const expectedMediumPerceptualHash = entry.expectedMediumPerceptualHash;
        const expectedPrecisePerceptualHash = entry.expectedPrecisePerceptualHash;
        // Verify the uploaded file matches the expected identity
        if (contentHash !== expectedContentHash ||
            softPerceptualHash !== expectedSoftPerceptualHash ||
            mediumPerceptualHash !== expectedMediumPerceptualHash ||
            precisePerceptualHash !== expectedPrecisePerceptualHash) {
            res.status(400).json({ error: "Uploaded file does not match the expected identity" });
            return;
        }
        // 7) Actually store the file in MinIO using the presigned "entry.url"
        const uploadResponse = await fetch(entry.url, {
            method: "POST",
            body: fileBuffer,
            headers: {
                "Content-Type": mimeType,
            },
        });
        if (!uploadResponse.ok) {
            throw new Error("Failed to upload file to MinIO via presigned URL");
        }
        res.json({
            message: "File uploaded successfully!",
            existingIdentity: !!existingMetadata,
            verifiedContentHash: contentHash,
            softPerceptualHash,
            mediumPerceptualHash,
            precisePerceptualHash,
            colorCode: colorCodeWithoutLeadingDash,
            color,
            carbonFootprint,
        });
        return;
    }
    catch (error) {
        logger.error("Error uploading file: " + error.message);
        res.status(500).json({ error: "File upload failed" });
        return;
    }
});
// Additional routes from your original file
app.get("/user_upload_count/:userDID", async (req, res) => {
    const { userDID } = req.params;
    try {
        const prefix = `users/${userDID}/uploads/`;
        const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
        let count = 0;
        for await (const _ of stream)
            count++;
        res.json({ userDID, uploadCount: count, maxAllowed: 10 });
        return;
    }
    catch (error) {
        logger.error("Error counting user uploads: " + error.message);
        res.status(500).json({ error: "Failed to retrieve upload count" });
        return;
    }
});
app.get("/user_indexes/:userDID", async (req, res) => {
    const { userDID } = req.params;
    const prefix = `indexes/${userDID}/`;
    try {
        const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
        const indexes = [];
        for await (const obj of stream) {
            indexes.push(obj.name);
        }
        res.json(indexes);
        return;
    }
    catch (error) {
        logger.error("Error listing user indexes: " + error.message);
        res.status(500).json({ error: "Failed to retrieve user indexes" });
        return;
    }
});
// ❗ Be careful: you used the same route name for userDID and username here. 
//   Adjust if you want them to be distinct endpoints.
app.get("/user_indexes/:username", async (req, res) => {
    const { username } = req.params;
    const prefix = `indexes/${username}/`;
    try {
        const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
        const indexes = [];
        for await (const obj of stream) {
            indexes.push(obj.name);
        }
        res.json(indexes);
        return;
    }
    catch (error) {
        logger.error("Error listing user indexes: " + error.message);
        res.status(500).json({ error: "Failed to retrieve user indexes" });
        return;
    }
});
// get public files by username
app.get("/public_files/:username", async (req, res) => {
    const { username } = req.params;
    const prefix = `public/${username}/`;
    try {
        const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
        const files = [];
        for await (const obj of stream) {
            files.push(obj.name);
        }
        res.json(files);
        return;
    }
    catch (error) {
        logger.error("Error listing public files: " + error.message);
        res.status(500).json({ error: "Failed to retrieve public files" });
        return;
    }
});
app.delete("/delete_upload/:userDID/:fileId", async (req, res) => {
    const { userDID, fileId } = req.params;
    try {
        // Search path: users/{userDID}/uploads/*/{fileId}
        const prefix = `users/${userDID}/uploads/`;
        const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
        const objectsToDelete = [];
        for await (const obj of stream) {
            if (obj.name.includes(fileId)) {
                objectsToDelete.push(obj.name);
            }
        }
        if (objectsToDelete.length === 0) {
            res.status(404).json({ error: "File not found" });
            return;
        }
        // Delete manifest draft if exists
        objectsToDelete.push(`${userDID}/drafts/uploads/${fileId}`);
        // Delete index metadata
        objectsToDelete.push(`indexes/${userDID}/file_map/${fileId}.json`);
        if (objectsToDelete.length === 0) {
            res.status(404).json({ error: "File not found" });
            return;
        }
        console.log("objectsToDelete", objectsToDelete);
        await minioClient.removeObjects(BUCKET, objectsToDelete);
        res.json({ message: "Upload and related metadata deleted" });
        return;
    }
    catch (error) {
        logger.error("Error deleting upload: " + error.message);
        res.status(500).json({ error: "Deletion failed" });
        return;
    }
});
app.delete("/delete_manifest/:userDID/:manifestId", async (req, res) => {
    const { userDID, manifestId } = req.params;
    const path = `users/${userDID}/manifests/${manifestId}`;
    try {
        await minioClient.removeObject(BUCKET, path);
        res.json({ message: "Manifest deleted successfully" });
        return;
    }
    catch (error) {
        logger.error("Error deleting manifest: " + error.message);
        res.status(500).json({ error: "Manifest deletion failed" });
        return;
    }
});
app.delete("/delete_public_manifest/:username/:manifestId", async (req, res) => {
    const { username, manifestId } = req.params;
    const path = `public/${username}/manifests/${manifestId}`;
    try {
        await minioClient.removeObject(BUCKET, path);
        res.json({ message: "Manifest deleted successfully" });
        return;
    }
    catch (error) {
        logger.error("Error deleting manifest: " + error.message);
        res.status(500).json({ error: "Manifest deletion failed" });
        return;
    }
});
// C2PA Signing Endpoint
app.post("/sign", async (req, res) => {
    try {
        const { fileId } = req.body;
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
        const vc = await signVC(manifest.asSendable(), process.env.ORIGIN_VAULT_DID_PASSWORD || "")
            .then((vc) => {
            console.log("signed vc", vc);
        })
            .catch((err) => {
            logger.error("Error signing VC: " + err.message);
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
    }
    catch (error) {
        logger.error(error.message);
        res.status(500).json({ error: "Signing failed" });
        return;
    }
});
app.get("/health", async (req, res) => {
    try {
        await getPrimaryDID()
            .then((rep) => {
            res.json({ message: `C2PA Server is healthy and MinIO is reachable. Primary DID: ${rep}` });
            return;
        })
            .catch((err) => {
            logger.error("Error fetching Primary DID: " + err.message);
            if (!res.headersSent) {
                res.status(200).json({
                    message: "C2PA Server is healthy and MinIO is reachable. Primary DID not found.",
                });
                return;
            }
        });
    }
    catch (error) {
        logger.error("Error fetching Primary DID: " + error.message);
        if (!res.headersSent) {
            res.status(500).json({ message: "C2PA Server is healthy, but MinIO is not reachable" });
            return;
        }
    }
});
app.post("/create_bucket", async (req, res) => {
    const { bucketName } = req.body;
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
app.get("/bucket_exists", async (req, res) => {
    const { bucketName } = req.body;
    const bucket = await minioClient.bucketExists(bucketName);
    res.json(bucket);
    return;
});
app.post("/request-download-url", async (req, res) => {
    const { fileName } = req.body;
    try {
        const downloadUrl = await minioClient.presignedGetObject(BUCKET, fileName, 2000);
        res.json({ downloadUrl });
    }
    catch (error) {
        logger.error("Error getting presigned url: " + error.message);
        res.status(500).json({ error: "Presigned url retrieval failed" });
        return;
    }
});
app.get("/list_buckets", async (req, res) => {
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
app.get("/", (req, res) => {
    res.json({ message: "C2PA Server is running" });
    return;
});
app.get("/list_files/:bucketName", async (req, res) => {
    const { bucketName } = req.params;
    try {
        const files = await minioClient.listObjects(bucketName, "", true);
        res.json(files);
        return;
    }
    catch (error) {
        logger.error("Error listing files: " + error.message);
        res.status(500).json({ error: "File listing failed" });
        return;
    }
});
// list all users files
app.get("/list_all_user_files", async (req, res) => {
    const fileList = [];
    try {
        const stream = await minioClient.listObjectsV2(BUCKET, "users/", true);
        for await (const obj of stream) {
            fileList.push({
                name: obj.name,
                etag: obj.etag,
                size: obj.size,
                lastModified: obj.lastModified,
            });
        }
        res.json(fileList);
        return;
    }
    catch (error) {
        console.error("Error listing user files:", error);
        res.status(500).json({ error: "Error listing user files" });
        return;
    }
});
app.get("/list_user_files/:userDID", async (req, res) => {
    const { userDID } = req.params;
    const prefix = `users/${userDID}/`;
    const fileList = [];
    try {
        const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
        for await (const obj of stream) {
            const nameWithoutPrefix = obj.name.replace(prefix, "");
            const snowflakeId = nameWithoutPrefix.split("/").pop();
            const mnemonic = snowflakeToMnemonic(snowflakeId);
            // Only return image files with preview URLs
            const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60); // expires in 60s
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
    catch (error) {
        console.error("Error listing user files:", error);
        res.status(500).json({ error: "Error listing user files" });
        return;
    }
});
// list all public files
app.get("/list_public_files", async (req, res) => {
    const fileList = [];
    try {
        const stream = minioClient.listObjectsV2(BUCKET, "public/", true);
        for await (const obj of stream) {
            const nameWithoutPrefix = obj.name.replace("public/", "");
            const snowflakeId = nameWithoutPrefix.split("/").pop();
            const mnemonic = snowflakeToMnemonic(snowflakeId);
            // Only return image files with preview URLs
            const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60); // expires in 60s
            // Get the identity data to include the filename
            try {
                // Find the identity file for this content
                const identityPath = `indexes/identities/${snowflakeId}.json`;
                const identityStream = await minioClient.getObject(BUCKET, identityPath).catch(() => null);
                let fileName = null;
                if (identityStream) {
                    const identityData = JSON.parse((await streamToBuffer(identityStream)).toString());
                    fileName = identityData.fileName;
                }
                fileList.push({
                    name: nameWithoutPrefix,
                    etag: obj.etag,
                    size: obj.size,
                    lastModified: obj.lastModified,
                    mnemonicId: mnemonic,
                    id: snowflakeId,
                    previewUrl,
                    fileName: fileName // Include the filename from identity
                });
            }
            catch (error) {
                // If we can't get the identity, still include the file but without filename
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
        }
        res.json(fileList);
        return;
    }
    catch (error) {
        logger.error("Error listing public files: " + error.message);
        res.status(500).json({ error: "Error listing public files" });
        return;
    }
});
app.get("/list_public_manifests", async (req, res) => {
    const fileList = [];
    try {
        const stream = minioClient.listObjectsV2(BUCKET, "public/manifests/", true);
        for await (const obj of stream) {
            const nameWithoutPrefix = obj.name.replace("public/manifests/", "");
            const snowflakeId = nameWithoutPrefix.split("/").pop();
            const mnemonic = snowflakeToMnemonic(snowflakeId);
            // Only return image files with preview URLs
            const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60); // expires in 60s
            fileList.push({
                name: nameWithoutPrefix,
                etag: obj.etag,
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
    catch (error) {
        logger.error("Error listing public manifests: " + error.message);
        res.status(500).json({ error: "Error listing public manifests" });
        return;
    }
});
app.get("/get_public_manifest/:manifestId", async (req, res) => {
    const { manifestId } = req.params;
    const manifest = await minioClient.getObject(BUCKET, `public/manifests/${manifestId}`);
    const previewUrl = await minioClient.presignedGetObject(BUCKET, `public/manifests/${manifestId}`, 60); // expires in 60s
    res.json({ manifest, previewUrl });
    return;
});
// get user public files by username
app.get("/get_user_public_files/:username", async (req, res) => {
    const { username } = req.params;
    const prefix = `public/${username}/`;
    const fileList = [];
    try {
        const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
        for await (const obj of stream) {
            const nameWithoutPrefix = obj.name.replace("public/", "");
            const snowflakeId = nameWithoutPrefix.split("/").pop();
            const mnemonic = snowflakeToMnemonic(snowflakeId);
            // Only return image files with preview URLs
            const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60); // expires in 60s
            // Get the identity data to include the filename
            try {
                // First try to get the file map which has the identity reference
                const fileMapPath = `indexes/${username}/${snowflakeId}.json`;
                const fileMapStream = await minioClient.getObject(BUCKET, fileMapPath).catch(() => null);
                let fileName = null;
                let identityData = null;
                if (fileMapStream) {
                    const fileMapData = JSON.parse((await streamToBuffer(fileMapStream)).toString());
                    const identityPath = fileMapData.identityRef;
                    if (identityPath) {
                        const identityStream = await minioClient.getObject(BUCKET, identityPath).catch(() => null);
                        if (identityStream) {
                            identityData = JSON.parse((await streamToBuffer(identityStream)).toString());
                            fileName = identityData.fileName;
                        }
                    }
                }
                fileList.push({
                    name: nameWithoutPrefix,
                    etag: obj.etag,
                    size: obj.size,
                    lastModified: obj.lastModified,
                    mnemonicId: mnemonic,
                    id: snowflakeId,
                    previewUrl,
                    fileName: fileName, // Include the filename from identity
                    color: identityData?.color,
                    colorCode: identityData?.colorCode
                });
            }
            catch (error) {
                // If we can't get the identity, still include the file but without filename
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
        }
        res.json(fileList);
        return;
    }
    catch (error) {
        logger.error("Error listing user public files: " + error.message);
        res.status(500).json({ error: "Error listing user public files" });
        return;
    }
});
app.get("/list_user_manifests/:userDID", async (req, res) => {
    const { userDID } = req.params;
    const prefix = `users/${userDID}/manifests/`;
    const fileList = [];
    try {
        const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
        for await (const obj of stream) {
            const nameWithoutPrefix = obj.name.replace("users/", "");
            const snowflakeId = nameWithoutPrefix.split("/").pop();
            const mnemonic = snowflakeToMnemonic(snowflakeId);
            // Only return image files with preview URLs
            const previewUrl = await minioClient.presignedGetObject(BUCKET, obj.name, 60); // expires in 60s
            fileList.push({
                name: obj.name,
                etag: obj.etag,
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
    catch (error) {
        logger.error("Error listing user manifests: " + error.message);
        res.status(500).json({ error: "Failed to retrieve user manifests" });
        return;
    }
});
app.get("/get_manifest/:manifestId", async (req, res) => {
    const { manifestId } = req.params;
    const manifest = await minioClient.getObject(BUCKET, manifestId);
    const previewUrl = await minioClient.presignedGetObject(BUCKET, manifestId, 60); // expires in 60s
    res.json({ manifest, previewUrl });
    return;
});
// save manifest draft
app.post("/save_user_manifest_draft", async (req, res) => {
    const { userDID, manifest, uploadId } = req.body;
    const manifestId = generateSnowflakeId();
    await minioClient.putObject(BUCKET, `${userDID}/drafts/uploads/${uploadId}/${manifestId}`, manifest);
    res.json({ message: "Manifest saved successfully" });
    return;
});
app.get("/get_user_manifest_draft/:userDID/:uploadId/:manifestId", async (req, res) => {
    const { userDID, uploadId, manifestId } = req.params;
    const manifest = await minioClient.getObject(BUCKET, `${userDID}/drafts/uploads/${uploadId}/${manifestId}`);
    const previewUrl = await minioClient.presignedGetObject(BUCKET, `${userDID}/drafts/uploads/${uploadId}/${manifestId}`, 60); // expires in 60s
    res.json({ manifest, previewUrl });
    return;
});
// get stored content and manifest draft
app.get("/get_stored_content_and_manifest_draft/:userDID/:uploadId", async (req, res) => {
    const { userDID, uploadId } = req.params;
    const content = await minioClient.getObject(BUCKET, `${userDID}/uploads/${uploadId}`);
    const manifest = await minioClient.getObject(BUCKET, `${userDID}/drafts/uploads/${uploadId}`);
    const previewUrl = await minioClient.presignedGetObject(BUCKET, `${userDID}/uploads/${uploadId}`, 60); // expires in 60s
    res.json({ content, manifest, previewUrl });
    return;
});
// list signed users files
app.get("/list_signed_user_files/:userDID", async (req, res) => {
    const { userDID } = req.params;
    const prefix = `signed-users/${userDID}/`;
    const fileList = [];
    try {
        const stream = minioClient.listObjectsV2(BUCKET, prefix, true);
        for await (const obj of stream) {
            fileList.push({
                name: obj.name,
                etag: obj.etag,
                size: obj.size,
                lastModified: obj.lastModified,
            });
        }
    }
    catch (error) {
        logger.error("Error listing signed user files: " + error.message);
        res.status(500).json({ error: "Error listing signed user files" });
        return;
    }
});
app.get("/get_signed_user_file/:userDID/:fileId", async (req, res) => {
    const { userDID, fileId } = req.params;
    const prefix = `signed-users/${userDID}/`;
    try {
        const file = await minioClient.getObject(BUCKET, `${prefix}${fileId}`);
        const previewUrl = await minioClient.presignedGetObject(BUCKET, `${prefix}${fileId}`, 60); // expires in 60s
        res.json({ file, previewUrl });
        return;
    }
    catch (error) {
        logger.error("Error getting signed user file: " + error.message);
        res.status(500).json({ error: "Error getting signed user file" });
        return;
    }
});
app.post("/get_file_by_mnemonic", async (req, res) => {
    const { mnemonic, userDID } = req.body;
    if (!mnemonic || !userDID) {
        res.status(400).json({ error: "Missing mnemonic or userDID" });
        return;
    }
    try {
        const fileId = mnemonicToSnowflake(mnemonic);
        const fileMapStream = await minioClient.getObject(BUCKET, `indexes/${userDID}/file_map/${fileId}.json`);
        let fileMapData = "";
        fileMapStream.on("data", (chunk) => {
            fileMapData += chunk;
        });
        fileMapStream.on("end", async () => {
            try {
                const fileMetadata = JSON.parse(fileMapData);
                const downloadUrl = await minioClient.presignedGetObject(BUCKET, fileMetadata.path, 60);
                res.json({ fileId, downloadUrl });
            }
            catch (err) {
                logger.error("Failed to parse file map or generate URL: " + err.message);
                res.status(500).json({ error: "Download URL generation failed" });
                return;
            }
        });
        fileMapStream.on("error", (err) => {
            logger.error("Error reading file map: " + err.message);
            res.status(500).json({ error: "File map retrieval failed" });
            return;
        });
    }
    catch (error) {
        logger.error("Unexpected error: " + error.message);
        res.status(500).json({ error: "File retrieval failed" });
        return;
    }
});
app.post("/get_public_file_by_mnemonic", async (req, res) => {
    const { mnemonic, username } = req.body;
    try {
        const fileId = mnemonicToSnowflake(mnemonic);
        const fileMapStream = await minioClient.getObject(BUCKET, `indexes/${username}/${fileId}.json`);
        let fileMapData = "";
        fileMapStream.on("data", (chunk) => {
            fileMapData += chunk;
        });
        fileMapStream.on("end", async () => {
            const fileMetadata = JSON.parse(fileMapData);
            const downloadUrl = await minioClient.presignedGetObject(BUCKET, fileMetadata.path, 60);
            res.json({ fileId, downloadUrl });
            return;
        });
    }
    catch (error) {
        logger.error("Error getting public file by mnemonic: " + error.message);
        res.status(500).json({ error: "Error getting public file by mnemonic" });
        return;
    }
});
app.get("/download/:uri", async (req, res) => {
    const { uri } = req.params;
    const entry = urlStore[uri];
    if (!entry) {
        res.status(404).json({ error: "Download URL not found or expired" });
        return;
    }
    try {
        // Fetch the file from MinIO using the presigned URL
        const downloadResponse = await fetch(entry.url);
        if (!downloadResponse.ok) {
            throw new Error("Failed to download file from MinIO");
        }
        const arrayBuffer = await downloadResponse.arrayBuffer();
        const fileBuffer = Buffer.from(arrayBuffer);
        res.setHeader("Content-Type", downloadResponse.headers.get("Content-Type") || "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${uri}"`);
        res.send(fileBuffer);
        return;
    }
    catch (error) {
        logger.error("Error downloading file: " + error.message);
        res.status(500).json({ error: "File download failed" });
        return;
    }
});
app.post("/publish-private-file", uploadLimiter, async (req, res) => {
    const { fileId, mnemonicId, userDID, username, fileName } = req.body;
    if (!fileId || !userDID || !username || !fileName) {
        res.status(400).json({ error: "Missing required fields" });
        return;
    }
    try {
        // 1. Check if the private file exists
        const privatePath = `users/${userDID}/uploads/${fileName}/${fileId}`;
        const privateFileStat = await minioClient.statObject(BUCKET, privatePath).catch(() => null);
        if (!privateFileStat) {
            res.status(404).json({ error: "Private file not found" });
            return;
        }
        // 2. Create the public path
        const publicPath = `public/${username}/${fileId}`;
        // 3. Check if this file is already published
        const publicFileStat = await minioClient.statObject(BUCKET, publicPath).catch(() => null);
        if (publicFileStat) {
            res.status(409).json({ error: "File is already published", publicPath });
            return;
        }
        // 4. Get the file content from the private path
        const privateFileStream = await minioClient.getObject(BUCKET, privatePath);
        const fileBuffer = await streamToBuffer(privateFileStream);
        // 5. Get the file's metadata from the identity index
        const fileMapPath = `indexes/${userDID}/file_map/${fileId}.json`;
        const fileMapStream = await minioClient.getObject(BUCKET, fileMapPath).catch(() => null);
        if (!fileMapStream) {
            res.status(404).json({ error: "File metadata not found" });
            return;
        }
        const fileMapData = JSON.parse((await streamToBuffer(fileMapStream)).toString());
        const identityPath = fileMapData.identityRef;
        // 6. Get the identity data
        const identityStream = await minioClient.getObject(BUCKET, identityPath).catch(() => null);
        if (!identityStream) {
            res.status(404).json({ error: "File identity not found" });
            return;
        }
        const identityData = JSON.parse((await streamToBuffer(identityStream)).toString());
        // 7. Copy the file to the public path
        await minioClient.putObject(BUCKET, publicPath, fileBuffer, privateFileStat.size, { "Content-Type": privateFileStat.metaData["content-type"] || "application/octet-stream" });
        // 8. Update the identity to include the public path
        identityData.username = username; // Add username to identity
        identityData.publicPath = publicPath; // Add public path reference
        await minioClient.putObject(BUCKET, identityPath, Buffer.from(JSON.stringify(identityData)), undefined, { "Content-Type": "application/json" });
        // 9. Create a public file map entry
        const publicFileMapData = {
            id: fileId,
            name: fileName,
            path: publicPath,
            uploadedAt: new Date().toISOString(),
            identityRef: identityPath,
            isPublished: true,
            uri: `https://${username}.originvault.me/embeddable/${mnemonicId}`
        };
        const publicFileMapPath = `indexes/${username}/${fileId}.json`;
        await minioClient.putObject(BUCKET, publicFileMapPath, Buffer.from(JSON.stringify(publicFileMapData)), undefined, { "Content-Type": "application/json" });
        // 10. Generate a presigned URL for the public file
        const publicUrl = await minioClient.presignedGetObject(BUCKET, publicPath, 60 * 60); // 1 hour expiry
        res.status(200).json({
            message: "File published successfully",
            id: fileId,
            name: fileName,
            path: publicPath,
            publicUrl,
            mnemonicId: snowflakeToMnemonic(fileId)
        });
    }
    catch (error) {
        logger.error("Error publishing file: " + error.message);
        res.status(500).json({ error: "File publication failed" });
        return;
    }
});
// Webhook endpoint for C2PA signing server integration
app.post("/webhooks/signing-completed", async (req, res) => {
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
// Start Server
app.listen(8080, async () => {
    if (!minioClient) {
        logger.error("MinIO client not initialized");
        return;
    }
    try {
        const uploadsExists = await minioClient.bucketExists(BUCKET);
        if (!uploadsExists) {
            await minioClient.makeBucket(BUCKET);
        }
    }
    catch (error) {
        throw error;
    }
    console.log("C2PA Server running on port 8080");
});
