import logger from "../logger.js";
import { parentStore } from "@originvault/ov-id-sdk";

// DID Assertion Schema for Storage DIDs
const STORAGE_DID_ASSERTION_SCHEMA = {
  "@context": [
    "https://www.w3.org/2018/credentials/v1",
    "https://github.com/decentralized-identity/credential-schemas/tree/main/community-schemas/OriginVault/draft-schemas/did-assertion"
  ],
  "type": ["VerifiableCredential", "DIDAssertion"],
  "credentialSubject": {
    "type": "StorageDID",
    "assertion": {
      "type": "StorageCapability",
      "capabilities": ["read", "write", "delete"],
      "scope": "user-content",
      "expiresAt": null
    }
  }
};

export interface StorageDidAssertion {
  did: string;
  userId?: string;
  type: "anonymous" | "user";
  capabilities: string[];
  scope: string;
  expiresAt?: string;
  createdAt: string;
}

export class StorageService {
  private mainDid: string;

  constructor() {
    const originVaultStorageDid = process.env.ORIGINVAULT_STORAGE_DID;
    if (!originVaultStorageDid) {
      throw new Error("ORIGINVAULT_STORAGE_DID environment variable is required");
    }
    this.mainDid = originVaultStorageDid;
  }

  /**
   * Create a storage DID with DID assertion as linked resource
   */
  async createStorageDid(userId?: string): Promise<string> {
    try {
      if (!parentStore.agent) {
        throw new Error('DID agent not available');
      }

      // Create a new DID using the agent
      const didResult = await parentStore.agent.createIdentifier({
        provider: 'did:cheqd:mainnet',
        alias: userId ? `storage-${userId}` : 'anonymous-storage'
      });

      const storageDid = didResult.did;
      logger.info(`Created storage DID: ${storageDid}`);

      // Create DID assertion as linked resource
      const assertion: StorageDidAssertion = {
        did: storageDid,
        userId,
        type: userId ? "user" : "anonymous",
        capabilities: ["read", "write", "delete"],
        scope: "user-content",
        createdAt: new Date().toISOString()
      };

      // Create the linked resource on the main DID
      await this.createStorageAssertion(storageDid, assertion);

      return storageDid;
    } catch (error) {
      logger.error(`Failed to create storage DID: ${error}`);
      throw error;
    }
  }

  /**
   * Create a DID assertion as linked resource on the main DID
   */
  private async createStorageAssertion(storageDid: string, assertion: StorageDidAssertion): Promise<void> {
    try {
      if (!parentStore.agent) {
        throw new Error('DID agent not available');
      }

      // Create the resource using the agent
      const resourceResult = await parentStore.agent.createResource({
        did: this.mainDid,
        name: `storage-assertion-${storageDid.split(':').pop()}`,
        type: "DIDAssertion",
        data: {
          ...STORAGE_DID_ASSERTION_SCHEMA,
          credentialSubject: {
            ...STORAGE_DID_ASSERTION_SCHEMA.credentialSubject,
            id: storageDid,
            ...assertion
          }
        },
        version: new Date().toISOString()
      });

      logger.info(`Created storage assertion for ${storageDid}: ${resourceResult.resourceId}`);
    } catch (error) {
      logger.error(`Failed to create storage assertion: ${error}`);
      throw error;
    }
  }

  /**
   * Find storage DID for a user
   */
  async findUserStorageDid(userId: string): Promise<string | null> {
    try {
      if (!parentStore.agent) {
        throw new Error('DID agent not available');
      }

      // Resolve the main DID to get linked resources
      const resolved = await parentStore.agent.resolveDid({ didUrl: this.mainDid });
      const linkedResources = resolved.didDocumentMetadata?.linkedResourceMetadata || [];

      // Find storage assertion for this user
      for (const resource of linkedResources) {
        if (resource.resourceType === "DIDAssertion") {
          try {
            // Get the resource data
            const resourceData = await parentStore.agent.getResource({
              did: this.mainDid,
              resourceId: resource.resourceId
            });

            if (resourceData && resourceData.credentialSubject?.userId === userId) {
              return resourceData.credentialSubject.did;
            }
          } catch (error) {
            logger.warn(`Failed to get resource data for ${resource.resourceId}: ${error}`);
          }
        }
      }

      return null;
    } catch (error) {
      logger.error(`Failed to find user storage DID: ${error}`);
      return null;
    }
  }

  /**
   * Find anonymous storage DID
   */
  async findAnonymousStorageDid(): Promise<string | null> {
    try {
      if (!parentStore.agent) {
        throw new Error('DID agent not available');
      }

      // Resolve the main DID to get linked resources
      const resolved = await parentStore.agent.resolveDid({ didUrl: this.mainDid });
      const linkedResources = resolved.didDocumentMetadata?.linkedResourceMetadata || [];

      // Find anonymous storage assertion
      for (const resource of linkedResources) {
        if (resource.resourceType === "DIDAssertion") {
          try {
            // Get the resource data
            const resourceData = await parentStore.agent.getResource({
              did: this.mainDid,
              resourceId: resource.resourceId
            });

            if (resourceData && resourceData.credentialSubject?.type === "anonymous") {
              return resourceData.credentialSubject.did;
            }
          } catch (error) {
            logger.warn(`Failed to get resource data for ${resource.resourceId}: ${error}`);
          }
        }
      }

      return null;
    } catch (error) {
      logger.error(`Failed to find anonymous storage DID: ${error}`);
      return null;
    }
  }

  /**
   * Ensure anonymous storage DID exists
   */
  async ensureAnonymousStorageDid(): Promise<string> {
    try {
      // First, try to find existing anonymous storage DID
      const existingDid = await this.findAnonymousStorageDid();
      if (existingDid) {
        logger.info(`Using existing anonymous storage DID: ${existingDid}`);
        return existingDid;
      }

      // Create new anonymous storage DID
      logger.info("Creating new anonymous storage DID...");
      const newDid = await this.createStorageDid();
      logger.info(`Created anonymous storage DID: ${newDid}`);

      return newDid;
    } catch (error) {
      logger.error(`Failed to ensure anonymous storage DID: ${error}`);
      throw error;
    }
  }

  /**
   * Create proof-of-upload as linked resource
   */
  async createProofOfUpload(
    storageDid: string,
    snowflake: string,
    mnemonicId: string,
    contentHash: string,
    fileName: string,
    size: number,
    mimeType: string,
    uploaderIpHash: string,
    manifestRef?: string,
    manifestMnemonicId?: string
  ): Promise<string> {
    try {
      if (!parentStore.agent) {
        throw new Error('DID agent not available');
      }

      const proofData = {
        type: "ProofOfUpload",
        snowflake,
        mnemonicId,
        contentHash,
        fileName,
        size,
        mimeType,
        uploaderIpHash,
        manifestRef,
        manifestMnemonicId,
        uploadedAt: new Date().toISOString()
      };

      // Create the proof as a linked resource on the storage DID
      const resourceResult = await parentStore.agent.createResource({
        did: storageDid,
        name: `proof-${snowflake}`,
        type: "ProofOfUpload",
        data: proofData,
        version: new Date().toISOString()
      });

      logger.info(`Created proof of upload for ${fileName}: ${resourceResult.resourceId}`);
      return resourceResult.resourceId;
    } catch (error) {
      logger.error(`Failed to create proof of upload: ${error}`);
      throw error;
    }
  }
}

// Singleton instance
export const storageService = new StorageService();
