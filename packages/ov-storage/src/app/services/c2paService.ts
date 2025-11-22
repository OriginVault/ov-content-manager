import logger from "../../logger.js";
import { createC2paClient, C2PA_SUPPORTED_TYPES } from "@originvault/ov-c2pa";
import type { C2PAManifestOptions, C2PAManifestResult } from "@originvault/ov-c2pa";

export class C2PAService {
  private client = createC2paClient({
    apiUrl: process.env.SSLCOM_API_URL || 'https://api.c2patool.io/api/v1',
    apiKey: process.env.SSLCOM_API_KEY || '',
    certificateProfileId: process.env.SSLCOM_CERTIFICATE_PROFILE_ID || '6ba3b70c-38fe-44c3-803f-910c5873d1d6',
    conformingProductId: process.env.SSLCOM_CONFORMING_PRODUCT_ID || 'f5ac57ef-428e-4a82-8852-7bde10b33060',
    subjectCN: process.env.SSLCOM_SUBJECT_CN || 'OriginVault C2PA',
    subjectO: process.env.SSLCOM_SUBJECT_O || 'OriginVault',
    subjectC: process.env.SSLCOM_SUBJECT_C || 'US'
  });

  /**
   * Check if a file type is supported by C2PA
   */
  isSupported(mimeType: string): boolean {
    return mimeType in C2PA_SUPPORTED_TYPES;
  }

  /**
   * Get supported file types
   */
  getSupportedTypes(): string[] {
    return Object.keys(C2PA_SUPPORTED_TYPES);
  }

  /**
   * Get file type info
   */
  getFileTypeInfo(mimeType: string): { format: string; extension: string } | null {
    return (C2PA_SUPPORTED_TYPES as Record<string, { format: string; extension: string }>)[mimeType] || null;
  }

  /**
   * Generate C2PA manifest for supported file types
   */
  async generateManifest(
    fileBuffer: Buffer,
    options: C2PAManifestOptions
  ): Promise<C2PAManifestResult> {
    try {
      return await this.client.generateManifest(fileBuffer, options);
    } catch (error) {
      logger.error("Failed to generate C2PA manifest:", error);
      return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
    }
  }

  /**
   * Get file category for metadata enhancement
   */
  getFileCategory(mimeType: string): string {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    if (mimeType.startsWith("model/")) return "3d";
    if (mimeType.startsWith("font/")) return "font";
    
    // Check for specific supported application types
    const supportedAppTypes = [
      "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/zip", "application/x-rar-compressed", "application/x-7z-compressed", "application/gzip", "application/x-tar",
      "application/json", "application/xml", "application/postscript", "application/eps", "application/ai"
    ];
    
    if (supportedAppTypes.includes(mimeType)) return "document";
    
    // Check for specific supported text types
    const supportedTextTypes = ["text/plain", "text/html", "text/css", "text/javascript", "text/markdown"];
    if (supportedTextTypes.includes(mimeType)) return "document";
    
    return "other";
  }

  /**
   * Get category-specific metadata
   */
  getCategorySpecificMetadata(category: string, options: C2PAManifestOptions): any {
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
  async signFile(fileBuffer: Buffer, mimeType: string, manifest: any): Promise<Buffer | null> {
    return await this.client.signFile(fileBuffer, mimeType, manifest);
  }

  /**
   * Read C2PA manifest from file
   */
  async readManifest(fileBuffer: Buffer, mimeType: string): Promise<any> {
    return await this.client.readManifest(fileBuffer, mimeType);
  }
}

// Export singleton instance
export const c2paService = new C2PAService();
