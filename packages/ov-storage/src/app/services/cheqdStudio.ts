import { loadConfig } from "../config.js";
import logger from "../../logger.js";
import { readFileSync } from "fs";
import { parentStore } from "@originvault/ov-id-sdk";

const config = loadConfig();

// Cheqd Studio API interfaces
export interface CheqdStudioConfig {
  baseUrl: string;
  customerId: string;
  network: string;
}

export interface CreateDidRequest {
  type: string;
  customerId: string;
  network: string;
}

export interface CreateDidResponse {
  did: string;
  customerId: string;
  network: string;
}

export interface CreateResourceRequest {
  did: string;
  resourceName: string;
  resourceType: string;
  data: any;
  version: string;
}

export interface CreateResourceResponse {
  resourceId: string;
  did: string;
  resourceName: string;
  resourceType: string;
  version: string;
}

export interface GetResourceRequest {
  did: string;
  resourceName?: string;
  resourceType?: string;
  version?: string;
}

export interface Resource {
  resourceId: string;
  did: string;
  resourceName: string;
  resourceType: string;
  data: any;
  version: string;
  createdAt: string;
}

export class DidManagerService {
  private config: CheqdStudioConfig;

  constructor() {
    this.config = {
      baseUrl: process.env.CHEQD_STUDIO_BASE_URL || "https://studio.cheqd.io",
      customerId: process.env.CHEQD_STUDIO_CUSTOMER_ID || "",
      network: process.env.CHEQD_NETWORK || "mainnet",
    };
  }

  private async makeRequest<T>(
    endpoint: string,
    method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
    body?: any
  ): Promise<T> {
    const url = `${this.config.baseUrl}${endpoint}`;
    
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Cheqd Studio API error: ${response.status} ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      logger.error(`Cheqd Studio API request failed: ${endpoint}`, error);
      throw error;
    }
  }

  async createStorageDid(): Promise<CreateDidResponse> {
    const request: CreateDidRequest = {
      type: "storage",
      customerId: this.config.customerId,
      network: this.config.network,
    };

    return this.makeRequest<CreateDidResponse>("/did/create/storage", "POST", request);
  }

  async createResource(request: CreateResourceRequest): Promise<CreateResourceResponse> {
    return this.makeRequest<CreateResourceResponse>("/resources/create", "POST", request);
  }

  async getResources(request: GetResourceRequest): Promise<Resource[]> {
    const params = new URLSearchParams();
    if (request.resourceName) params.append("resourceName", request.resourceName);
    if (request.resourceType) params.append("resourceType", request.resourceType);
    if (request.version) params.append("version", request.version);

    const endpoint = `/resources/search/${request.did}?${params.toString()}`;
    return this.makeRequest<Resource[]>(endpoint);
  }

  async getDidDocument(did: string): Promise<any> {
    return this.makeRequest(`/did/document/${did}`);
  }

  async transferDidOwnership(did: string, newController: string): Promise<void> {
    return this.makeRequest(`/did/transfer/${did}`, "POST", {
      newController,
      customerId: this.config.customerId,
    });
  }

  // Helper method to create Proof-of-Upload DLR
  async createProofOfUpload(
    bucketDid: string,
    snowflake: string,
    mnemonicId: string,
    contentHash: string,
    fileName: string,
    size: number,
    mimeType: string,
    uploaderIpHash: string,
    manifestRef?: string,
    manifestMnemonicId?: string
  ): Promise<CreateResourceResponse> {
    const data = {
      snowflake,
      mnemonicId,
      contentHash,
      fileName,
      size,
      mimeType,
      uploaderIpHash,
      createdAt: new Date().toISOString(),
      manifestRef,
      manifestMnemonicId,
    };

    const request: CreateResourceRequest = {
      did: bucketDid,
      resourceName: snowflake,
      resourceType: "proof-of-upload",
      data,
      version: new Date().toISOString(),
    };

    return this.createResource(request);
  }

  // Helper method to find anonymous bucket DID
  async findAnonymousBucketDid(): Promise<string | null> {
    // Use the main DID from package.json
    const mainDid = this.getMainDid();
    
    try {
      // Use DID agent for resolution instead of Cheqd Studio
      const didDocument = await this.resolveDidDocument(mainDid);
      
      if (didDocument && didDocument.linkedResourceMetadata) {
        for (const resource of didDocument.linkedResourceMetadata) {
          if (resource.resourceType === "originvault.bucket" && 
              resource.resourceName === "anonymous-bucket") {
            // Get the actual resource data
            const resourceData = await this.getResourceData(mainDid, resource.resourceId);
            if (resourceData && resourceData.data && resourceData.data.did) {
              return resourceData.data.did;
            }
          }
        }
      }

      return null;
    } catch (error) {
      logger.warn("Failed to find anonymous bucket DID:", error);
      return null;
    }
  }

  // Use DID agent to resolve DID document
  private async resolveDidDocument(did: string): Promise<any> {
    try {
      // Use the DID agent from ov-id-sdk for resolution
      const resolved = await parentStore.resolve(did);
      return resolved;
    } catch (error) {
      logger.error("Failed to resolve DID document:", error);
      throw error;
    }
  }

  // Get resource data using DID agent
  private async getResourceData(did: string, resourceId: string): Promise<any> {
    try {
      const resource = await parentStore.getResource(did, resourceId);
      return resource;
    } catch (error) {
      logger.error("Failed to get resource data:", error);
      throw error;
    }
  }

  // Helper method to get the main DID from environment variable
  private getMainDid(): string {
    const originVaultStorageDid = process.env.ORIGINVAULT_STORAGE_DID;
    if (!originVaultStorageDid) {
      throw new Error("ORIGINVAULT_STORAGE_DID not configured");
    }
    return originVaultStorageDid;
  }

  // Helper method to create anonymous bucket DID and DLR
  async ensureAnonymousBucketDid(): Promise<string> {
    // First, try to find existing anonymous bucket DID using DID agent
    const existingDid = await this.findAnonymousBucketDid();
    if (existingDid) {
      logger.info(`Found existing anonymous bucket DID: ${existingDid}`);
      return existingDid;
    }

    // Create new storage DID using Cheqd Studio
    logger.info("Creating new anonymous bucket DID...");
    const didResponse = await this.createStorageDid();
    const newDid = didResponse.did;

    // Create DLR on the main DID using Cheqd Studio
    const mainDid = this.getMainDid();

    const bucketData = {
      did: newDid,
      createdAt: new Date().toISOString(),
      type: "anonymous-bucket",
    };

    const resourceRequest: CreateResourceRequest = {
      did: mainDid,
      resourceName: "anonymous-bucket",
      resourceType: "originvault.bucket",
      data: bucketData,
      version: new Date().toISOString(),
    };

    await this.createResource(resourceRequest);
    logger.info(`Created anonymous bucket DID: ${newDid} as linked resource on ${mainDid}`);

    return newDid;
  }

  // Helper method to create user storage DID
  async createUserStorageDid(userId: string): Promise<string> {
    logger.info(`Creating storage DID for user: ${userId}`);
    
    const didResponse = await this.createStorageDid();
    const storageDid = didResponse.did;

    // Create DLR mapping user to storage DID on the main DID
    const mainDid = this.getMainDid();

    const userData = {
      userId,
      storageDid,
      createdAt: new Date().toISOString(),
      type: "user-storage",
    };

    const resourceRequest: CreateResourceRequest = {
      did: mainDid,
      resourceName: `user-${userId}`,
      resourceType: "originvault.user-storage",
      data: userData,
      version: new Date().toISOString(),
    };

    await this.createResource(resourceRequest);
    logger.info(`Created storage DID for user ${userId}: ${storageDid} as linked resource on ${mainDid}`);

    return storageDid;
  }

  // Helper method to find user storage DID
  async findUserStorageDid(userId: string): Promise<string | null> {
    const mainDid = this.getMainDid();

    try {
      // Use DID agent for resolution instead of Cheqd Studio
      const didDocument = await this.resolveDidDocument(mainDid);
      
      if (didDocument && didDocument.linkedResourceMetadata) {
        for (const resource of didDocument.linkedResourceMetadata) {
          if (resource.resourceType === "originvault.user-storage" && 
              resource.resourceName === `user-${userId}`) {
            // Get the actual resource data
            const resourceData = await this.getResourceData(mainDid, resource.resourceId);
            if (resourceData && resourceData.data && resourceData.data.storageDid) {
              return resourceData.data.storageDid;
            }
          }
        }
      }

      return null;
    } catch (error) {
      logger.warn(`Failed to find storage DID for user ${userId}:`, error);
      return null;
    }
  }
}

// Singleton instance
export const cheqdStudioService = new DidManagerService();
