# OriginVault Content Manager - Sequence Implementation Roadmap

## 🎯 **Objective**
Complete the cold storage infrastructure to support the full sequence diagram, focusing on journal sync endpoints, enhanced DID management, and blockchain anchoring integration.

## 📊 **Current Status: 85% Complete**

### ✅ **What's Already Working**
- **Complete C2PA Server**: Full manifest generation and signing
- **Storage DID Management**: Automatic per-user storage DID creation
- **S3/MinIO Integration**: Presigned URLs, quota management, cleanup
- **Proof-of-Upload DLRs**: cheqd-studio integration for PoU creation
- **Authentication**: Logto OIDC integration with scope validation
- **Anonymous Uploads**: IP quotas, hCaptcha, automatic cleanup

## 🔧 **What Needs Implementation**

### **1. Journal Sync Endpoints** 
**Priority: HIGH** | **Estimated: 3-4 days**

#### **Files to Create/Modify:**
```bash
src/app/routes/journalSync.ts                        # NEW
src/app/services/journalSyncService.ts               # NEW
src/app/routes/storage.ts                           # ENHANCE
src/app/services/storageService.ts                  # ENHANCE
```

#### **Key Implementation Tasks:**

**A. Journal Sync Routes**
```typescript
// src/app/routes/journalSync.ts - NEW
import express from "express";
import { requireAuth } from "../auth.js";
import { journalSyncService } from "../services/journalSyncService.js";

const router = express.Router();

/**
 * POST /journal/sync-batch - Sync journal entries from frontend
 */
router.post("/sync-batch", requireAuth, async (req, res) => {
  try {
    const { journalEntries, userDid, popVC } = req.body;
    const userId = req.auth?.sub;
    
    if (!journalEntries || !userDid || !popVC) {
      res.status(400).json({ 
        error: "Missing required fields: journalEntries, userDid, popVC" 
      });
      return;
    }
    
    // Find or create user's storage DID
    let storageDid = await storageService.findUserStorageDid(userId);
    if (!storageDid) {
      storageDid = await storageService.createStorageDid(userId);
    }
    
    // Sync journal entries to storage
    const result = await journalSyncService.syncJournalEntries(
      journalEntries,
      storageDid,
      popVC,
      userId
    );
    
    res.json({
      success: true,
      storageDid,
      syncedEntries: result.syncedEntries,
      pouUrls: result.pouUrls,
      message: `Synced ${result.syncedEntries} journal entries`
    });
    
  } catch (error) {
    logger.error("Journal sync failed:", error);
    res.status(500).json({ 
      error: "Journal sync failed",
      details: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

/**
 * POST /journal/replay-anonymous - Replay anonymous journal entries
 */
router.post("/replay-anonymous", requireAuth, async (req, res) => {
  try {
    const { sessionId, journalEntries } = req.body;
    const userId = req.auth?.sub;
    
    // Link anonymous entries to authenticated user
    const result = await journalSyncService.replayAnonymousJournals(
      sessionId,
      userId,
      journalEntries
    );
    
    res.json({
      success: true,
      linkedEntries: result.linkedEntries,
      upgradedCredentials: result.upgradedCredentials,
      message: "Anonymous journal entries linked to account"
    });
    
  } catch (error) {
    logger.error("Anonymous journal replay failed:", error);
    res.status(500).json({ error: "Journal replay failed" });
  }
});

export default router;
```

**B. Journal Sync Service**
```typescript
// src/app/services/journalSyncService.ts - NEW
import { storageService } from "./storageService.js";
import { cheqdStudioService } from "./cheqdStudio.js";
import logger from "../../logger.js";

export interface OfflineJournalEntry {
  journalId: string;
  monotonicSeq: number;
  prevEntryHash: string;
  deviceClaimedTs: number;
  contentHash: string;
  perceptualHash: string;
  contentMetadata: {
    fileName: string;
    fileSize: number;
    mimeType: string;
  };
  popId: string;
  popIssuer: string;
  popServerTs: string;
  popDigest: string;
  popBindingSig: string;
  edkPublic: any;
  deviceSignature: string;
  anchorState: 'unanchored' | 'anchored' | 'synced' | 'verified';
}

export interface JournalSyncResult {
  syncedEntries: number;
  failedEntries: number;
  pouUrls: string[];
  errors: string[];
}

export class JournalSyncService {
  async syncJournalEntries(
    journalEntries: OfflineJournalEntry[],
    storageDid: string,
    popVC: any,
    userId: string
  ): Promise<JournalSyncResult> {
    const pouUrls: string[] = [];
    const errors: string[] = [];
    let syncedEntries = 0;
    let failedEntries = 0;
    
    for (const entry of journalEntries) {
      try {
        // 1. Verify journal entry integrity
        const isValid = await this.verifyJournalEntry(entry, popVC);
        if (!isValid) {
          errors.push(`Invalid journal entry: ${entry.journalId}`);
          failedEntries++;
          continue;
        }
        
        // 2. Store journal entry as file in storage
        const journalKey = `journals/${userId}/${entry.journalId}.json`;
        await this.storeJournalEntry(entry, journalKey, storageDid);
        
        // 3. Create Proof-of-Upload DLR
        const pouUrl = await this.createJournalPoU(entry, storageDid);
        pouUrls.push(pouUrl);
        
        syncedEntries++;
        
      } catch (error) {
        logger.error(`Failed to sync journal entry ${entry.journalId}:`, error);
        errors.push(`Sync failed for ${entry.journalId}: ${error.message}`);
        failedEntries++;
      }
    }
    
    return {
      syncedEntries,
      failedEntries,
      pouUrls,
      errors
    };
  }
  
  async replayAnonymousJournals(
    sessionId: string,
    userId: string,
    journalEntries: OfflineJournalEntry[]
  ): Promise<{
    linkedEntries: number;
    upgradedCredentials: number;
  }> {
    // Link anonymous journal entries to authenticated user account
    let linkedEntries = 0;
    let upgradedCredentials = 0;
    
    for (const entry of journalEntries) {
      try {
        // Update entry with user information
        const upgradedEntry = {
          ...entry,
          userId,
          linkedAt: new Date().toISOString(),
          anchorState: 'anchored' as const
        };
        
        // Store upgraded entry
        await this.storeUpgradedJournalEntry(upgradedEntry, userId);
        
        linkedEntries++;
        upgradedCredentials++;
        
      } catch (error) {
        logger.error(`Failed to link journal entry ${entry.journalId}:`, error);
      }
    }
    
    return { linkedEntries, upgradedCredentials };
  }
  
  private async verifyJournalEntry(
    entry: OfflineJournalEntry,
    popVC: any
  ): Promise<boolean> {
    // Verify journal entry against PoP credential
    // Check signatures, hashes, and chain integrity
    return true; // Implement verification logic
  }
  
  private async storeJournalEntry(
    entry: OfflineJournalEntry,
    journalKey: string,
    storageDid: string
  ): Promise<void> {
    // Store journal entry as JSON file in MinIO
    const journalData = JSON.stringify(entry, null, 2);
    
    await minioClient.putObject(
      config.minio.bucket,
      journalKey,
      Buffer.from(journalData),
      journalData.length,
      {
        "Content-Type": "application/json",
        "x-amz-meta-journal-id": entry.journalId,
        "x-amz-meta-storage-did": storageDid,
        "x-amz-meta-content-hash": entry.contentHash,
        "x-amz-meta-upload-time": new Date().toISOString()
      }
    );
  }
  
  private async createJournalPoU(
    entry: OfflineJournalEntry,
    storageDid: string
  ): Promise<string> {
    // Create Proof-of-Upload DLR for journal entry
    return await storageService.createProofOfUpload(
      storageDid,
      entry.journalId,
      entry.journalId, // Use journalId as mnemonic
      entry.contentHash,
      entry.contentMetadata.fileName,
      entry.contentMetadata.fileSize,
      entry.contentMetadata.mimeType,
      "", // No IP hash for authenticated uploads
      undefined, // No manifest for journal entries
      undefined
    );
  }
  
  private async storeUpgradedJournalEntry(
    entry: OfflineJournalEntry & { userId: string; linkedAt: string },
    userId: string
  ): Promise<void> {
    // Store upgraded journal entry with user linkage
    const upgradeKey = `upgraded-journals/${userId}/${entry.journalId}.json`;
    
    await minioClient.putObject(
      config.minio.bucket,
      upgradeKey,
      Buffer.from(JSON.stringify(entry, null, 2)),
      undefined,
      {
        "Content-Type": "application/json",
        "x-amz-meta-user-id": userId,
        "x-amz-meta-journal-id": entry.journalId,
        "x-amz-meta-linked-at": entry.linkedAt
      }
    );
  }
}

export const journalSyncService = new JournalSyncService();
```

### **2. Enhanced Storage Service**
**Priority: HIGH** | **Estimated: 2-3 days**

#### **Files to Modify:**
```bash
src/app/services/storageService.ts                  # ENHANCE
src/app/routes/storage.ts                          # ENHANCE
```

#### **Key Implementation Tasks:**

**A. Enhanced Storage Service**
```typescript
// src/app/services/storageService.ts - ENHANCE EXISTING
export class StorageService {
  // EXISTING: All current functionality
  
  // NEW: Add journal sync capabilities
  async findUserStorageDid(userId: string): Promise<string | null> {
    // EXISTING: Implementation already exists
    // ENHANCE: Add caching and error handling
  }
  
  async getStorageQuota(
    userId: string,
    storageDid: string
  ): Promise<{
    currentUsage: number;
    maxQuota: number;
    usagePercentage: number;
    isOverQuota: boolean;
    journalCount: number;
    fileCount: number;
  }> {
    // NEW: Get comprehensive storage usage including journals
    const bucketService = new BucketService(minioClient);
    const quotaInfo = await bucketService.getQuotaInfo(userId, storageDid);
    
    // Count journal entries separately
    const journalCount = await this.countJournalEntries(userId);
    
    return {
      ...quotaInfo,
      journalCount,
      fileCount: quotaInfo.files.length
    };
  }
  
  async transferDidOwnership(
    storageDid: string,
    newController: string,
    userId: string
  ): Promise<{ success: boolean; transactionHash?: string }> {
    // NEW: Complete DID ownership transfer via cheqd Studio
    try {
      // Call cheqd Studio API to transfer DID ownership
      const result = await cheqdStudioService.transferDidOwnership(
        storageDid,
        newController
      );
      
      // Update local records
      await this.updateStorageDidOwnership(userId, storageDid, newController);
      
      return { success: true, transactionHash: result.transactionHash };
    } catch (error) {
      logger.error(`Failed to transfer DID ownership: ${error}`);
      return { success: false };
    }
  }
  
  private async countJournalEntries(userId: string): Promise<number> {
    // Count journal entries for user
    const objects = minioClient.listObjects(
      config.minio.bucket,
      `journals/${userId}/`,
      true
    );
    
    let count = 0;
    for await (const obj of objects) {
      if (obj.name.endsWith('.json')) count++;
    }
    
    return count;
  }
  
  private async updateStorageDidOwnership(
    userId: string,
    storageDid: string,
    newController: string
  ): Promise<void> {
    // Update local records of DID ownership
    // This could be stored in Redis or a database
    logger.info(`Updated DID ownership: ${storageDid} -> ${newController}`);
  }
}
```

### **3. Webhook Integration for KYC Completion**
**Priority: HIGH** | **Estimated: 2-3 days**

#### **Files to Create/Modify:**
```bash
src/app/routes/webhooks.ts                          # NEW
src/app/services/kycWebhookService.ts               # NEW
```

#### **Key Implementation Tasks:**

**A. KYC Webhook Handler**
```typescript
// src/app/routes/webhooks.ts - NEW
import express from "express";
import { kycWebhookService } from "../services/kycWebhookService.js";
import logger from "../../logger.js";

const router = express.Router();

/**
 * POST /webhooks/kyc-completed - Handle KYC completion from vault agent
 */
router.post("/kyc-completed", async (req, res) => {
  try {
    const { userId, mainDid, verifiedAt, sessionId } = req.body;
    
    // Verify webhook signature (implement proper security)
    const signature = req.headers['x-webhook-signature'] as string;
    if (!kycWebhookService.verifySignature(req.body, signature)) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }
    
    // Handle KYC completion
    const result = await kycWebhookService.handleKYCCompletion(
      userId,
      mainDid,
      verifiedAt,
      sessionId
    );
    
    res.json({
      success: true,
      storageDid: result.storageDid,
      ownershipTransferred: result.ownershipTransferred,
      message: "KYC completion processed successfully"
    });
    
  } catch (error) {
    logger.error("KYC webhook processing failed:", error);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

/**
 * POST /webhooks/tier-upgrade - Handle user tier upgrades
 */
router.post("/tier-upgrade", async (req, res) => {
  try {
    const { userId, fromTier, toTier, upgradeData } = req.body;
    
    // Handle tier upgrade (e.g., authenticated -> verified)
    const result = await kycWebhookService.handleTierUpgrade(
      userId,
      fromTier,
      toTier,
      upgradeData
    );
    
    res.json({
      success: true,
      newCapabilities: result.newCapabilities,
      storageQuotaIncrease: result.storageQuotaIncrease,
      message: `User upgraded from ${fromTier} to ${toTier}`
    });
    
  } catch (error) {
    logger.error("Tier upgrade webhook failed:", error);
    res.status(500).json({ error: "Tier upgrade failed" });
  }
});

export default router;
```

**B. KYC Webhook Service**
```typescript
// src/app/services/kycWebhookService.ts - NEW
import crypto from "crypto";
import { storageService } from "./storageService.js";
import { cheqdStudioService } from "./cheqdStudio.js";
import logger from "../../logger.js";

export class KYCWebhookService {
  private webhookSecret = process.env.WEBHOOK_SECRET || "";
  
  verifySignature(payload: any, signature: string): boolean {
    // Verify webhook signature using HMAC
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(JSON.stringify(payload))
      .digest('hex');
    
    return signature === expectedSignature;
  }
  
  async handleKYCCompletion(
    userId: string,
    mainDid: string,
    verifiedAt: string,
    sessionId: string
  ): Promise<{
    storageDid: string;
    ownershipTransferred: boolean;
  }> {
    try {
      // 1. Find user's storage DID
      let storageDid = await storageService.findUserStorageDid(userId);
      
      if (!storageDid) {
        // Create storage DID if it doesn't exist
        storageDid = await storageService.createStorageDid(userId);
        logger.info(`Created storage DID for verified user ${userId}: ${storageDid}`);
      }
      
      // 2. Transfer storage DID ownership to user's main DID
      const transferResult = await storageService.transferDidOwnership(
        storageDid,
        mainDid,
        userId
      );
      
      // 3. Update storage capabilities for verified user
      await this.upgradeStorageCapabilities(userId, storageDid);
      
      logger.info(`KYC completion processed for user ${userId}`, {
        storageDid,
        ownershipTransferred: transferResult.success,
        verifiedAt
      });
      
      return {
        storageDid,
        ownershipTransferred: transferResult.success
      };
      
    } catch (error) {
      logger.error(`KYC completion handling failed for user ${userId}:`, error);
      throw error;
    }
  }
  
  async handleTierUpgrade(
    userId: string,
    fromTier: string,
    toTier: string,
    upgradeData: any
  ): Promise<{
    newCapabilities: string[];
    storageQuotaIncrease: number;
  }> {
    const newCapabilities: string[] = [];
    let storageQuotaIncrease = 0;
    
    if (toTier === 'verified') {
      // Verified users get enhanced capabilities
      newCapabilities.push('cloud_storage', 'enhanced_quota', 'priority_support');
      storageQuotaIncrease = 50 * 1024 * 1024 * 1024; // 50GB increase
      
      // Update storage quota
      await this.updateStorageQuota(userId, storageQuotaIncrease);
    }
    
    return { newCapabilities, storageQuotaIncrease };
  }
  
  private async upgradeStorageCapabilities(
    userId: string,
    storageDid: string
  ): Promise<void> {
    // Upgrade storage capabilities for verified users
    // Could include increased quotas, priority access, etc.
    logger.info(`Upgraded storage capabilities for verified user ${userId}`);
  }
  
  private async updateStorageQuota(
    userId: string,
    quotaIncrease: number
  ): Promise<void> {
    // Update user's storage quota
    // This could be stored in Redis or a database
    logger.info(`Increased storage quota for user ${userId} by ${quotaIncrease} bytes`);
  }
}

export const kycWebhookService = new KYCWebhookService();
```

### **4. Enhanced cheqd Studio Integration**
**Priority: MEDIUM** | **Estimated: 2-3 days**

#### **Files to Modify:**
```bash
src/app/services/cheqdStudio.ts                     # ENHANCE
src/app/services/didManager.ts                      # ENHANCE
```

#### **Key Implementation Tasks:**

**A. Enhanced cheqd Studio Service**
```typescript
// src/app/services/cheqdStudio.ts - ENHANCE EXISTING
export class DidManagerService {
  // EXISTING: All current functionality
  
  // NEW: Add DID ownership transfer
  async transferDidOwnership(
    did: string,
    newController: string
  ): Promise<{ success: boolean; transactionHash: string }> {
    try {
      const response = await this.makeRequest(`/did/transfer/${did}`, "POST", {
        newController,
        customerId: this.config.customerId
      });
      
      return {
        success: true,
        transactionHash: response.transactionHash
      };
    } catch (error) {
      logger.error(`DID ownership transfer failed: ${error}`);
      return { success: false, transactionHash: "" };
    }
  }
  
  // NEW: Add status list management
  async createStatusList(
    did: string,
    statusListName: string,
    purpose: 'revocation' | 'suspension' = 'revocation'
  ): Promise<{ statusListUrl: string; resourceId: string }> {
    const request = {
      did,
      statusListName,
      statusPurpose: purpose,
      length: 131072, // Minimum for privacy
      encrypted: true,
      paymentConditions: [{
        feePaymentAddress: process.env.CHEQD_PAYMENT_ADDRESS,
        feePaymentAmount: 1000, // 1000 ncheq
        feePaymentWindow: 600 // 10 minutes
      }]
    };
    
    const response = await this.makeRequest("/credential-status/create/encrypted", "POST", request);
    
    return {
      statusListUrl: response.statusListUrl,
      resourceId: response.resourceId
    };
  }
  
  async updateStatusList(
    did: string,
    statusListName: string,
    indices: number[],
    action: 'revoke' | 'suspend' | 'activate'
  ): Promise<{ updated: boolean }> {
    const request = {
      did,
      statusListName,
      statusAction: action,
      indices,
      symmetricKey: process.env.STATUS_LIST_ENCRYPTION_KEY
    };
    
    const response = await this.makeRequest("/credential-status/update/encrypted", "POST", request);
    
    return { updated: response.updated };
  }
}
```

### **5. API Enhancements**
**Priority: MEDIUM** | **Estimated: 2-3 days**

#### **Files to Create/Modify:**
```bash
src/app/routes/storage.ts                          # ENHANCE
src/app/routes/verification.ts                     # NEW
```

#### **Key Implementation Tasks:**

**A. Enhanced Storage Routes**
```typescript
// src/app/routes/storage.ts - ENHANCE EXISTING
// Add new endpoints:

/**
 * POST /storage/claim-ownership - Claim storage DID ownership
 */
router.post("/claim-ownership", requireAuth, async (req, res) => {
  try {
    const { userMainDid } = req.body;
    const userId = req.auth?.sub;
    
    // Find user's storage DID
    const storageDid = await storageService.findUserStorageDid(userId);
    if (!storageDid) {
      res.status(404).json({ error: "No storage DID found for user" });
      return;
    }
    
    // Transfer ownership
    const result = await storageService.transferDidOwnership(
      storageDid,
      userMainDid,
      userId
    );
    
    res.json({
      success: result.success,
      storageDid,
      newController: userMainDid,
      transactionHash: result.transactionHash
    });
    
  } catch (error) {
    logger.error("Storage DID ownership claim failed:", error);
    res.status(500).json({ error: "Ownership claim failed" });
  }
});

/**
 * GET /storage/user-quota/:userId - Get user's storage quota
 */
router.get("/user-quota/:userId", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const requestingUserId = req.auth?.sub;
    
    // Verify user can access this quota info
    if (userId !== requestingUserId) {
      res.status(403).json({ error: "Access denied" });
      return;
    }
    
    const storageDid = await storageService.findUserStorageDid(userId);
    if (!storageDid) {
      res.status(404).json({ error: "No storage DID found" });
      return;
    }
    
    const quota = await storageService.getStorageQuota(userId, storageDid);
    
    res.json({
      success: true,
      quota,
      storageDid
    });
    
  } catch (error) {
    logger.error("Get storage quota failed:", error);
    res.status(500).json({ error: "Failed to get quota" });
  }
});
```

**B. Verification Routes**
```typescript
// src/app/routes/verification.ts - NEW
import express from "express";
import { requireAuth } from "../auth.js";
import { kycWebhookService } from "../services/kycWebhookService.js";

const router = express.Router();

/**
 * GET /verification/status/:userId - Get user verification status
 */
router.get("/status/:userId", requireAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get verification status from vault agent
    const vaultAgentUrl = process.env.VAULT_AGENT_URL || 'https://agent.create.originvault.me';
    const response = await fetch(`${vaultAgentUrl}/auth/get-user/${userId}`, {
      headers: { 'Authorization': req.headers.authorization }
    });
    
    const user = await response.json();
    
    res.json({
      success: true,
      verification: {
        verified: user.customData?.personhoodVerified || false,
        verifiedAt: user.customData?.personhoodVerifiedAt,
        tier: user.customData?.personhoodVerified ? 'verified' : 'authenticated',
        mainDid: user.customData?.cheqd?.mainnet,
        testnetDid: user.customData?.cheqd?.testnet
      }
    });
    
  } catch (error) {
    logger.error("Get verification status failed:", error);
    res.status(500).json({ error: "Failed to get verification status" });
  }
});

export default router;
```

## 🔗 **Integration Requirements**

### **Environment Variables to Add:**
```bash
# Vault Agent Integration
VAULT_AGENT_URL=https://agent.create.originvault.me
VAULT_AGENT_API_KEY=your_api_key_here

# Webhook Configuration
WEBHOOK_SECRET=your_webhook_secret_here
KYC_WEBHOOK_ENABLED=true

# Storage Configuration
DEFAULT_STORAGE_QUOTA_GB=10
VERIFIED_USER_QUOTA_GB=60
JOURNAL_STORAGE_ENABLED=true

# cheqd Configuration
STATUS_LIST_ENCRYPTION_KEY=your_encryption_key_here
CHEQD_PAYMENT_ADDRESS=your_cheqd_address_here
```

### **Package Dependencies to Add:**
```json
{
  "dependencies": {
    "node-cron": "^3.0.2",
    "ioredis": "^5.3.2",
    "zod": "^3.22.0"
  }
}
```

## 🧪 **Testing Requirements**

### **Unit Tests to Add:**
```bash
src/app/services/__tests__/journalSyncService.test.ts         # NEW
src/app/services/__tests__/kycWebhookService.test.ts          # NEW
src/app/routes/__tests__/journalSync.test.ts                 # NEW
src/app/routes/__tests__/webhooks.test.ts                    # NEW
```

### **Integration Tests:**
```bash
src/app/__tests__/journalSyncIntegration.test.ts             # NEW
src/app/__tests__/kycWebhookIntegration.test.ts              # NEW
src/app/__tests__/storageDidTransfer.test.ts                # NEW
```

## 📋 **Implementation Checklist**

### **Phase 1: Journal Sync Infrastructure (Week 1)**
- [ ] Create JournalSyncService
- [ ] Add journal sync routes
- [ ] Enhance StorageService with quota management
- [ ] Add webhook endpoints for KYC completion
- [ ] Write unit tests for new services
- [ ] Test journal sync with mock data

### **Phase 2: KYC Integration (Week 2)**
- [ ] Create KYCWebhookService
- [ ] Add webhook signature verification
- [ ] Implement DID ownership transfer
- [ ] Add verification status endpoints
- [ ] Write webhook integration tests
- [ ] Test KYC completion flow end-to-end

### **Phase 3: Enhanced Features (Week 3)**
- [ ] Add storage quota management
- [ ] Implement tier-based capabilities
- [ ] Add status list management
- [ ] Create monitoring and metrics
- [ ] Write comprehensive integration tests
- [ ] Performance testing and optimization

## 🎯 **Success Criteria**

### **API Endpoints:**
- **POST /journal/sync-batch** - Sync journal entries from frontend ✅
- **POST /journal/replay-anonymous** - Link anonymous entries to accounts ✅
- **POST /webhooks/kyc-completed** - Handle KYC completion ✅
- **POST /storage/claim-ownership** - Transfer storage DID ownership ✅
- **GET /verification/status/:userId** - Get user verification status ✅

### **Integration Points:**
- **Vault Agent**: Receive KYC completion webhooks
- **Public Utility Tool**: Accept journal sync requests
- **cheqd Studio**: Transfer DID ownership and manage status lists

### **Performance Goals:**
- **Journal sync**: < 5 seconds for 100 entries
- **Storage quota check**: < 500ms response time
- **DID ownership transfer**: < 30 seconds completion
- **Webhook processing**: < 2 seconds response time

## 🚀 **Getting Started**

1. **Review existing storage infrastructure** - Understand current capabilities
2. **Set up webhook endpoints** - Foundation for vault agent integration
3. **Implement journal sync service** - Core functionality for sequence diagram
4. **Test with mock data** - Verify functionality before integration

## 📈 **Expected Outcomes**

After completing this roadmap:
- **Complete cold storage backend** for sequence diagram
- **Seamless journal sync** from frontend to cloud storage
- **Automated KYC completion handling** with DID ownership transfer
- **Enhanced storage management** with quotas and capabilities
- **Production-ready webhook infrastructure**

---

**Estimated Total Time**: 2-3 weeks  
**Current Progress**: 85% complete  
**Next Milestone**: Journal sync endpoints with webhook integration
