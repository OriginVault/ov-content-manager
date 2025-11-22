import { createC2pa, createTestSigner, ManifestBuilder } from "c2pa-node";
import logger from "../../logger.js";
// Comprehensive list of C2PA-supported file types
export const C2PA_SUPPORTED_TYPES = {
    // Image formats
    "image/jpeg": { format: "image/jpeg", extension: "jpg" },
    "image/jpg": { format: "image/jpeg", extension: "jpg" },
    "image/png": { format: "image/png", extension: "png" },
    "image/gif": { format: "image/gif", extension: "gif" },
    "image/webp": { format: "image/webp", extension: "webp" },
    "image/tiff": { format: "image/tiff", extension: "tiff" },
    "image/tif": { format: "image/tiff", extension: "tif" },
    "image/bmp": { format: "image/bmp", extension: "bmp" },
    "image/heic": { format: "image/heic", extension: "heic" },
    "image/heif": { format: "image/heif", extension: "heif" },
    "image/avif": { format: "image/avif", extension: "avif" },
    // Video formats
    "video/mp4": { format: "video/mp4", extension: "mp4" },
    "video/quicktime": { format: "video/quicktime", extension: "mov" },
    "video/x-msvideo": { format: "video/x-msvideo", extension: "avi" },
    "video/x-ms-wmv": { format: "video/x-ms-wmv", extension: "wmv" },
    "video/webm": { format: "video/webm", extension: "webm" },
    "video/ogg": { format: "video/ogg", extension: "ogv" },
    "video/mpeg": { format: "video/mpeg", extension: "mpg" },
    "video/x-matroska": { format: "video/x-matroska", extension: "mkv" },
    // Audio formats
    "audio/mpeg": { format: "audio/mpeg", extension: "mp3" },
    "audio/wav": { format: "audio/wav", extension: "wav" },
    "audio/ogg": { format: "audio/ogg", extension: "ogg" },
    "audio/flac": { format: "audio/flac", extension: "flac" },
    "audio/aac": { format: "audio/aac", extension: "aac" },
    "audio/m4a": { format: "audio/m4a", extension: "m4a" },
    "audio/webm": { format: "audio/webm", extension: "webm" },
    // Document formats
    "application/pdf": { format: "application/pdf", extension: "pdf" },
    "application/msword": { format: "application/msword", extension: "doc" },
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { format: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", extension: "docx" },
    "application/vnd.ms-excel": { format: "application/vnd.ms-excel", extension: "xls" },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { format: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", extension: "xlsx" },
    "application/vnd.ms-powerpoint": { format: "application/vnd.ms-powerpoint", extension: "ppt" },
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": { format: "application/vnd.openxmlformats-officedocument.presentationml.presentation", extension: "pptx" },
    // 3D and CAD formats
    "model/gltf+json": { format: "model/gltf+json", extension: "gltf" },
    "model/gltf-binary": { format: "model/gltf-binary", extension: "glb" },
    "model/obj": { format: "model/obj", extension: "obj" },
    "model/stl": { format: "model/stl", extension: "stl" },
    "model/fbx": { format: "model/fbx", extension: "fbx" },
    "model/3ds": { format: "model/3ds", extension: "3ds" },
    // Archive formats
    "application/zip": { format: "application/zip", extension: "zip" },
    "application/x-rar-compressed": { format: "application/x-rar-compressed", extension: "rar" },
    "application/x-7z-compressed": { format: "application/x-7z-compressed", extension: "7z" },
    "application/gzip": { format: "application/gzip", extension: "gz" },
    "application/x-tar": { format: "application/x-tar", extension: "tar" },
    // Text formats
    "text/plain": { format: "text/plain", extension: "txt" },
    "text/html": { format: "text/html", extension: "html" },
    "text/css": { format: "text/css", extension: "css" },
    "text/javascript": { format: "text/javascript", extension: "js" },
    "application/json": { format: "application/json", extension: "json" },
    "application/xml": { format: "application/xml", extension: "xml" },
    "text/markdown": { format: "text/markdown", extension: "md" },
    // Font formats
    "font/woff": { format: "font/woff", extension: "woff" },
    "font/woff2": { format: "font/woff2", extension: "woff2" },
    "font/ttf": { format: "font/ttf", extension: "ttf" },
    "font/otf": { format: "font/otf", extension: "otf" },
    // Vector graphics
    "image/svg+xml": { format: "image/svg+xml", extension: "svg" },
    "application/postscript": { format: "application/postscript", extension: "ps" },
    "application/eps": { format: "application/eps", extension: "eps" },
    "application/ai": { format: "application/ai", extension: "ai" },
    // Raw image formats
    "image/x-raw": { format: "image/x-raw", extension: "raw" },
    "image/x-adobe-dng": { format: "image/x-adobe-dng", extension: "dng" },
    "image/x-canon-cr2": { format: "image/x-canon-cr2", extension: "cr2" },
    "image/x-nikon-nef": { format: "image/x-nikon-nef", extension: "nef" },
    "image/x-sony-arw": { format: "image/x-sony-arw", extension: "arw" },
    // Additional video formats
    "video/x-flv": { format: "video/x-flv", extension: "flv" },
    "video/x-ms-asf": { format: "video/x-ms-asf", extension: "asf" },
    "video/3gpp": { format: "video/3gpp", extension: "3gp" },
    "video/3gpp2": { format: "video/3gpp2", extension: "3g2" },
    // Additional audio formats
    "audio/x-ms-wma": { format: "audio/x-ms-wma", extension: "wma" },
    "audio/x-aiff": { format: "audio/x-aiff", extension: "aiff" },
    "audio/x-m4a": { format: "audio/x-m4a", extension: "m4a" },
    "audio/x-wav": { format: "audio/x-wav", extension: "wav" }
};
export class C2PAService {
    c2pa;
    signer;
    constructor() {
        this.c2pa = createC2pa();
        this.signer = createTestSigner();
    }
    /**
     * Check if a file type is supported by C2PA
     */
    isSupported(mimeType) {
        return mimeType in C2PA_SUPPORTED_TYPES;
    }
    /**
     * Get supported file types
     */
    getSupportedTypes() {
        return Object.keys(C2PA_SUPPORTED_TYPES);
    }
    /**
     * Get file type info
     */
    getFileTypeInfo(mimeType) {
        return C2PA_SUPPORTED_TYPES[mimeType] || null;
    }
    /**
     * Generate C2PA manifest for supported file types
     */
    async generateManifest(fileBuffer, options) {
        try {
            const { mimeType } = options;
            if (!this.isSupported(mimeType)) {
                return {
                    success: false,
                    error: `File type ${mimeType} is not supported for C2PA manifest generation`
                };
            }
            const fileTypeInfo = this.getFileTypeInfo(mimeType);
            if (!fileTypeInfo) {
                return {
                    success: false,
                    error: `Unable to determine file type info for ${mimeType}`
                };
            }
            // Create manifest with comprehensive metadata
            const manifest = new ManifestBuilder({
                title: options.title,
                format: fileTypeInfo.format,
                claim_generator: "OriginVault C2PA Server",
                claim_generator_hints: {
                    software: "storage-server",
                    version: "1.0.0",
                    platform: "node.js"
                }
            });
            // Add custom metadata based on file type category
            const category = this.getFileCategory(mimeType);
            const additionalMetadata = this.getCategorySpecificMetadata(category, options);
            Object.assign(manifest, additionalMetadata);
            // Generate manifest key
            const manifestKey = options.isAnonymous
                ? `anonymous/manifests/${options.mnemonicId}/manifest.json`
                : `users/${options.userId}/${options.mnemonicId}/manifest.json`;
            const manifestMnemonicId = options.mnemonicId;
            return {
                success: true,
                manifest,
                manifestKey,
                manifestMnemonicId
            };
        }
        catch (error) {
            logger.error("Failed to generate C2PA manifest:", error);
            return {
                success: false,
                error: error instanceof Error ? error.message : "Unknown error"
            };
        }
    }
    /**
     * Get file category for metadata enhancement
     */
    getFileCategory(mimeType) {
        if (mimeType.startsWith("image/"))
            return "image";
        if (mimeType.startsWith("video/"))
            return "video";
        if (mimeType.startsWith("audio/"))
            return "audio";
        if (mimeType.startsWith("model/"))
            return "3d";
        if (mimeType.startsWith("font/"))
            return "font";
        // Check for specific supported application types
        const supportedAppTypes = [
            "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/zip", "application/x-rar-compressed", "application/x-7z-compressed", "application/gzip", "application/x-tar",
            "application/json", "application/xml", "application/postscript", "application/eps", "application/ai"
        ];
        if (supportedAppTypes.includes(mimeType))
            return "document";
        // Check for specific supported text types
        const supportedTextTypes = ["text/plain", "text/html", "text/css", "text/javascript", "text/markdown"];
        if (supportedTextTypes.includes(mimeType))
            return "document";
        return "other";
    }
    /**
     * Get category-specific metadata
     */
    getCategorySpecificMetadata(category, options) {
        const baseMetadata = {
            // Common metadata for all files
            "xmp:Creator": options.userId || "anonymous",
            "xmp:CreateDate": options.uploadTime.toISOString(),
            "xmp:ModifyDate": options.uploadTime.toISOString(),
            "xmp:MetadataDate": options.uploadTime.toISOString(),
            "xmp:Identifier": options.snowflake,
            "xmp:ContentHash": options.contentHash,
            "xmp:FileName": options.fileName,
            "xmp:FileSize": options.fileSize,
            "xmp:MnemonicId": options.mnemonicId
        };
        switch (category) {
            case "image":
                return {
                    ...baseMetadata,
                    "xmp:ImageWidth": "auto-detected",
                    "xmp:ImageHeight": "auto-detected",
                    "xmp:ColorSpace": "auto-detected",
                    "xmp:ColorMode": "auto-detected"
                };
            case "video":
                return {
                    ...baseMetadata,
                    "xmp:VideoWidth": "auto-detected",
                    "xmp:VideoHeight": "auto-detected",
                    "xmp:VideoFrameRate": "auto-detected",
                    "xmp:VideoDuration": "auto-detected",
                    "xmp:VideoCodec": "auto-detected"
                };
            case "audio":
                return {
                    ...baseMetadata,
                    "xmp:AudioSampleRate": "auto-detected",
                    "xmp:AudioChannels": "auto-detected",
                    "xmp:AudioDuration": "auto-detected",
                    "xmp:AudioCodec": "auto-detected"
                };
            case "3d":
                return {
                    ...baseMetadata,
                    "xmp:ModelType": "3D",
                    "xmp:ModelFormat": options.mimeType,
                    "xmp:ModelVersion": "1.0"
                };
            case "document":
                return {
                    ...baseMetadata,
                    "xmp:DocumentType": "Document",
                    "xmp:DocumentFormat": options.mimeType,
                    "xmp:PageCount": "auto-detected"
                };
            case "font":
                return {
                    ...baseMetadata,
                    "xmp:FontType": "Font",
                    "xmp:FontFormat": options.mimeType,
                    "xmp:FontFamily": "auto-detected"
                };
            default:
                return baseMetadata;
        }
    }
    /**
     * Sign a file with C2PA manifest
     */
    async signFile(fileBuffer, mimeType, manifest) {
        try {
            const asset = { buffer: fileBuffer, mimeType };
            const signedBuffer = await this.c2pa.sign({ asset, signer: this.signer, manifest });
            return signedBuffer.signedAsset.buffer;
        }
        catch (error) {
            logger.error("Failed to sign file with C2PA:", error);
            return null;
        }
    }
    /**
     * Read C2PA manifest from file
     */
    async readManifest(fileBuffer, mimeType) {
        try {
            const manifest = await this.c2pa.read({ buffer: fileBuffer, mimeType });
            return manifest;
        }
        catch (error) {
            logger.error("Failed to read C2PA manifest:", error);
            return null;
        }
    }
}
// Export singleton instance
export const c2paService = new C2PAService();
