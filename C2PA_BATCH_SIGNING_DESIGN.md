# C2PA Batch Signing API Design
**Package:** `ov-content-manager`  
**Goal:** Production-grade REST API for hash-only batch C2PA signing at scale (10k–10M items)

---

## 📋 Overview

**What users asked for:**
- Hash-only signing (no file storage/transfer)
- Massive scale (10k–10M items) with idempotency and resumability
- Minimal storage footprint
- Provable anchoring with Merkle roots and compact DLR (≤ ~42 KB)
- Simple, reliable REST (GraphQL later)

**Design Principles:**
- ✅ Asynchronous jobs with explicit lifecycle
- ✅ Streaming ingestion (NDJSON or S3-style multipart)
- ✅ Hash-only items (no asset bytes)
- ✅ Manifest templating (one template per batch)
- ✅ Deterministic outputs (reproducible)
- ✅ Vector commitments (Merkle trees)
- ✅ No asset storage (clients keep bytes)

---

## 🏗️ Core Resources & Lifecycle

### Batch Object (server-managed)

```typescript
interface Batch {
  batchId: string;              // "bat_01HZ...9K"
  state: BatchState;            // created|ingesting|running|completed|failed|canceled
  counters: {
    itemsTotal: number;         // Total items ingested
    itemsAccepted: number;      // Valid items accepted
    itemsSigned: number;        // Successfully signed
    itemsFailed: number;        // Failed items
  };
  config: {
    mode: 'hashOnly';           // Only mode for MVP
    signingTier: 'basic' | 'pro' | 'verified';
    template: C2PATemplate;     // Shared manifest template
    anchor: boolean;            // Whether to create DLR
    chunkSize: number;          // Items per chunk (default 10000)
    webhookUrl?: string;        // Completion webhook
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  results?: {
    dlrId?: string;             // DLR ID if anchored
    batchMerkleRoot?: string;   // Root hash of all chunks
    manifestsLocation?: string; // Optional: presigned archive URL
    reportLocation?: string;    // CSV/JSONL with per-item statuses
  };
}

interface C2PATemplate {
  actions: string[];            // ["c2pa.created", "c2pa.edited"]
  title?: string;               // Batch title
  claim_generator?: string;     // Software identifier
  assertions?: Record<string, any>; // Custom assertions
}

type BatchState = 
  | 'created'      // Batch created, awaiting items
  | 'ingesting'    // Items being uploaded
  | 'running'      // Processing items
  | 'completed'    // All items processed
  | 'failed'       // Batch failed (recoverable)
  | 'canceled';    // User canceled
```

### Batch Item (ephemeral, hash-only)

```typescript
interface BatchItem {
  sha256: string;               // Hex-encoded SHA-256 (required)
  externalId?: string;          // Client's reference ID
  metadata?: Record<string, any>; // Small JSON (folded into manifest)
}

interface BatchItemResult {
  externalId?: string;
  sha256: string;
  status: 'signed' | 'failed';
  manifestHash?: string;        // If signed successfully
  error?: {
    code: string;               // Enumerated error code
    message: string;
  };
  proof?: {
    type: 'merkle';
    chunkId: number;
    leafHash: string;
    pathLocation?: string;      // Pointer to off-chain proof blob
  };
}
```

---

## 🔌 MVP REST Endpoints

### 1. Create Batch

```
POST /api/c2pa/batches
Authorization: Bearer <api_key>
Idempotency-Key: <uuid>
Content-Type: application/json
```

**Request:**
```json
{
  "mode": "hashOnly",
  "signingTier": "pro",
  "anchor": true,
  "template": {
    "actions": ["c2pa.created"],
    "title": "Invoices 2025-10"
  },
  "chunkSize": 10000,
  "webhookUrl": "https://client.app/ov/webhook"
}
```

**Response:** `201 Created`
```json
{
  "batchId": "bat_01HZ...9K",
  "state": "created",
  "ingest": {
    "format": "ndjson",
    "maxChunk": 10000,
    "endpoint": "/api/c2pa/batches/bat_01HZ...9K/items"
  }
}
```

---

### 2. Ingest Items (Stream)

```
POST /api/c2pa/batches/{batchId}/items
Content-Type: application/x-ndjson
Idempotency-Key: <uuid>
```

**Request Body (NDJSON):**
```json
{"sha256":"2b8e...","externalId":"inv-0001","metadata":{"docType":"invoice","amount":123.45}}
{"sha256":"9c43...","externalId":"inv-0002"}
{"sha256":"7f1a...","externalId":"inv-0003"}
```

**Response:** `202 Accepted`
```json
{
  "accepted": 10000,
  "duplicates": 0,
  "rejected": 0,
  "itemsTotal": 10000,
  "state": "ingesting"
}
```

**Notes:**
- Clients can POST multiple times to stream items
- Server dedupes on `(batchId, sha256)`
- Batch state transitions to `ingesting` on first item
- Optional: Provide presigned S3 URL for large NDJSON uploads

---

### 3. Start Processing

```
POST /api/c2pa/batches/{batchId}/start
Authorization: Bearer <api_key>
```

**Response:** `202 Accepted`
```json
{
  "batchId": "bat_01HZ...9K",
  "state": "running",
  "estimatedCompletionSec": 3600
}
```

---

### 4. Poll Status

```
GET /api/c2pa/batches/{batchId}
Authorization: Bearer <api_key>
```

**Response:** `200 OK`
```json
{
  "batchId": "bat_01HZ...9K",
  "state": "running",
  "counters": {
    "itemsTotal": 1000000,
    "itemsAccepted": 1000000,
    "itemsSigned": 420000,
    "itemsFailed": 1200
  },
  "progress": {
    "percent": 42.1,
    "etaSec": 3480
  },
  "chunks": [
    {"id": 1, "state": "done", "root": "0xabc..."},
    {"id": 2, "state": "running"},
    {"id": 3, "state": "pending"}
  ]
}
```

---

### 5. Fetch Results (Paginated)

```
GET /api/c2pa/batches/{batchId}/results?cursor=<cursor>&limit=1000
Authorization: Bearer <api_key>
```

**Response:** `200 OK`
```json
{
  "items": [
    {
      "externalId": "inv-0001",
      "sha256": "2b8e...",
      "status": "signed",
      "manifestHash": "0x7f3a..."
    },
    {
      "externalId": "inv-0042",
      "sha256": "9c43...",
      "status": "failed",
      "error": {
        "code": "C2PA_UNSUPPORTED_MEDIA",
        "message": "Hash format invalid"
      }
    }
  ],
  "nextCursor": "eyJvZmZzZXQiOjEwMDB9",
  "hasMore": true
}
```

**Alternative: Download Full Report**
```
GET /api/c2pa/batches/{batchId}/results/download
```
Returns presigned URL to CSV/Parquet report.

---

### 6. Get Final Results (On Completion)

When `state` = `completed`, the batch object includes:

```json
{
  "state": "completed",
  "results": {
    "dlrId": "dlr:cheqd:mainnet:xyz123",
    "batchMerkleRoot": "0xBATCHROOT...",
    "reportLocation": "https://download.originvault.box/reports/bat_01HZ.csv",
    "manifestsArchive": "https://download.originvault.box/archives/bat_01HZ.tar.gz"
  }
}
```

---

### 7. Webhook (Async Notification)

```
POST {webhookUrl}
Content-Type: application/json
X-OV-Signature: <hmac>
```

**Payload:**
```json
{
  "type": "batch.completed",
  "batchId": "bat_01HZ...9K",
  "summary": {
    "signed": 998734,
    "failed": 1266,
    "batchMerkleRoot": "0x...",
    "dlrId": "dlr:cheqd:mainnet:xyz123"
  },
  "timestamp": "2025-10-17T12:34:56Z"
}
```

---

### 8. Cancel / Resume

```
POST /api/c2pa/batches/{batchId}/cancel
POST /api/c2pa/batches/{batchId}/resume
```

---

## 🔐 Integrity & Proofs at Scale

### Per-Chunk Commitments

1. **Chunk Processing:**
   - Group items into chunks (≤ 10k items each)
   - Build Merkle tree per chunk
   - Store chunk root: `chunkRoot[i] = MerkleRoot(items[i*10k : (i+1)*10k])`

2. **Batch Root:**
   - Once all chunks complete: `batchRoot = MerkleRoot(chunkRoot[])`
   - Publish `batchRoot` to DLR

3. **Per-Item Proof:**
   - Each item gets: `{chunkId, leafHash, proofPath}`
   - Proof path can be full sibling hashes OR pointer to off-chain blob

### DLR Structure (≤ ~42KB)

```json
{
  "type": "C2PABatchSigningProof",
  "batchId": "bat_01HZ...9K",
  "templateHash": "0x...",
  "signerInfo": {
    "did": "did:cheqd:mainnet:signer123",
    "certificate": "hash or reference"
  },
  "timestamps": {
    "created": "...",
    "started": "...",
    "completed": "..."
  },
  "summary": {
    "itemsTotal": 1000000,
    "itemsSigned": 998734,
    "itemsFailed": 1266
  },
  "batchMerkleRoot": "0xBATCHROOT...",
  "chunkRoots": [
    "0xCHUNK_001...",
    "0xCHUNK_002...",
    "..."
  ],
  "proofsLocation": "ipfs://Qm..." // Off-chain proof blob reference
}
```

**For very large batches (>10k chunks):**
- Store only `batchMerkleRoot` + `proofsLocationHash` in DLR
- Publish full `chunkRoots` array off-chain (IPFS/S3)

---

## ⚡ Idempotency, Retries & Backpressure

### Idempotency Keys
- All mutating endpoints accept `Idempotency-Key` header
- Server stores `(key, operation, result)` for 24 hours
- Duplicate requests return cached result

### Deduplication
- Ingest endpoint dedupes on `(batchId, sha256)`
- Duplicate items: `accepted: 0, duplicates: N`

### Backpressure
- When queue saturated: `429 Too Many Requests`
- Headers: `Retry-After: 60`, `X-RateLimit-Reset: <timestamp>`

---

## ❌ Error Codes (Stable, Enumerated)

**Batch-Level:**
- `BATCH_NOT_FOUND` - Batch ID doesn't exist
- `BATCH_LOCKED` - Batch is running, can't modify
- `BATCH_CLOSED` - Batch completed, can't add items
- `BATCH_CANCELED` - Batch was canceled
- `INVALID_INPUT` - Malformed request
- `RATE_LIMITED` - Too many requests
- `PLAN_LIMIT_EXCEEDED` - Usage quota exceeded

**Item-Level:**
- `C2PA_SIGN_FAILED` - Signing operation failed
- `C2PA_CERT_EXPIRED` - Certificate expired
- `C2PA_UNSUPPORTED_MEDIA` - Invalid hash format
- `INVALID_HASH` - sha256 not valid hex

**Infrastructure:**
- `DLR_WRITE_FAILED` - Couldn't write to Cheqd
- `TIMESTAMP_UNAVAILABLE` - TSA unavailable
- `STORAGE_ERROR` - S3/storage failure

---

## 💰 Pricing & Metering

### Per-Item Signing
- **Basic:** $0.50/sign (1 credit)
- **Pro:** $1.00/sign (2 credits)

### Per-Batch Operations
- **DLR Creation:** $0.25 per batch (if `anchor: true`)
- **Batch VC:** Optional `ProofOfBatchSigningCredential` ($0.10)

### Example: 1M Pro signs + anchored
- 1,000,000 items × $1.00 = $1,000
- 1 DLR = $0.25
- **Total:** $1,000.25

### Subscription Overage
- Creator (100/mo): Overage $0.29/sign
- Pro (500/mo): Overage $0.19/sign
- Studio (2000/mo): Overage $0.14/sign

**Billing Hook:**
```typescript
await billingService.deductCredits({
  userId,
  service: 'c2pa',
  tier: 'pro',
  quantity: itemsSigned,
  batchId
});

if (config.anchor) {
  await billingService.deductCredits({
    userId,
    service: 'dlr',
    tier: 'create',
    quantity: 1,
    batchId
  });
}
```

---

## 📊 Performance & Scaling

### Configuration Knobs
- **chunkSize:** 1k–20k (default 10k)
- **maxConcurrentChunks:** 4–16 per tenant
- **signingTier:** Routes to different pools (Sandbox/TEE/HSM)
- **workerPoolSize:** Scale workers horizontally

### Rate Limits (Per Tenant)
- **Batch Creation:** 100/hour
- **Item Ingestion:** 1M items/hour
- **Results Polling:** 60 req/min

### Response Headers
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1697558400
```

---

## 🔒 Security & Compliance

### No PII
- Batch metadata: strict schema validation
- No file data ever leaves client (hash-only)

### Audit Trail
Record in database:
```typescript
{
  tenantId,
  batchId,
  manifestTemplateHash,
  counters,
  batchMerkleRoot,
  dlrId,
  costUsd,
  createdAt,
  completedAt
}
```

### Request Signing (Optional)
- Support HMAC signatures for webhook delivery
- Optional DPoP for API key proof-of-possession

---

## 📦 Implementation Checklist

### Week 1: MVP (Core Functionality)
- [ ] Database schema for batches, items, chunks
- [ ] `POST /batches` - Create batch
- [ ] `POST /batches/{id}/items` - NDJSON ingest (10k lines/chunk)
- [ ] `POST /batches/{id}/start` - Start processing
- [ ] `GET /batches/{id}` - Status polling
- [ ] `GET /batches/{id}/results` - Paginated results
- [ ] Async workers with Bull/BullMQ queue
- [ ] Per-chunk Merkle trees
- [ ] Batch Merkle root computation
- [ ] DLR write on completion (if `anchor: true`)
- [ ] Idempotency key handling
- [ ] Rate limiting middleware

### Week 2: Scale & Polish
- [ ] S3 presigned URL for large NDJSON uploads
- [ ] Webhooks with retry + HMAC signature
- [ ] CSV/Parquet report generation
- [ ] Batch-level VC (`ProofOfBatchSigningCredential`)
- [ ] Dedicated signer pools (Sandbox vs Production)
- [ ] Billing integration:
  - [ ] Decrement credits per signed item
  - [ ] Charge 1 DLR per anchored batch
- [ ] Per-tenant concurrency limits
- [ ] Metrics & monitoring (Prometheus)
- [ ] Admin dashboard for batch monitoring

### Week 3: Production Hardening
- [ ] Resume/retry logic for failed chunks
- [ ] Off-chain proof blob storage (IPFS/S3)
- [ ] Batch cancellation & cleanup
- [ ] Comprehensive error handling
- [ ] Load testing (1M+ items)
- [ ] Documentation & API examples
- [ ] SDK/CLI for batch operations

---

## 🚀 Example Flows

### A) 1M Invoices, Hash-Only, Anchored

```bash
# 1. Create batch
curl -X POST https://api.originvault.box/api/c2pa/batches \
  -H "Authorization: Bearer OV_LIVE_..." \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "hashOnly",
    "signingTier": "pro",
    "anchor": true,
    "template": {"actions": ["c2pa.created"], "title": "Invoices Q4 2025"},
    "chunkSize": 10000
  }'
# → { "batchId": "bat_01HZ...", "state": "created" }

# 2. Stream items (100 uploads × 10k items = 1M)
for file in invoices_*.ndjson; do
  curl -X POST https://api.originvault.box/api/c2pa/batches/bat_01HZ/items \
    -H "Authorization: Bearer OV_LIVE_..." \
    -H "Content-Type: application/x-ndjson" \
    --data-binary @$file
done

# 3. Start processing
curl -X POST https://api.originvault.box/api/c2pa/batches/bat_01HZ/start \
  -H "Authorization: Bearer OV_LIVE_..."

# 4. Poll status
while true; do
  curl https://api.originvault.box/api/c2pa/batches/bat_01HZ \
    -H "Authorization: Bearer OV_LIVE_..." | jq '.state, .progress'
  sleep 10
done

# 5. Download results
curl https://api.originvault.box/api/c2pa/batches/bat_01HZ/results/download \
  -H "Authorization: Bearer OV_LIVE_..." \
  -o batch_results.csv
```

### B) Resume Interrupted Ingest

```bash
# If network broke at 430k items, re-POST with same idempotency key
curl -X POST https://api.originvault.box/api/c2pa/batches/bat_01HZ/items \
  -H "Idempotency-Key: same-key-as-before" \
  -H "Content-Type: application/x-ndjson" \
  --data-binary @invoices_43.ndjson
# → Dedupes automatically, continues from 430k+1
```

---

## 🗄️ Database Schema (PostgreSQL)

```sql
CREATE TABLE batches (
  batch_id VARCHAR(32) PRIMARY KEY,
  tenant_id VARCHAR(64) NOT NULL,
  state VARCHAR(16) NOT NULL,
  config JSONB NOT NULL,
  counters JSONB NOT NULL DEFAULT '{"itemsTotal":0,"itemsAccepted":0,"itemsSigned":0,"itemsFailed":0}',
  results JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  INDEX idx_tenant_state (tenant_id, state),
  INDEX idx_created_at (created_at DESC)
);

CREATE TABLE batch_items (
  item_id BIGSERIAL PRIMARY KEY,
  batch_id VARCHAR(32) NOT NULL REFERENCES batches(batch_id),
  sha256 VARCHAR(64) NOT NULL,
  external_id VARCHAR(255),
  metadata JSONB,
  chunk_id INT,
  status VARCHAR(16),
  manifest_hash VARCHAR(66),
  error_code VARCHAR(32),
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(batch_id, sha256),
  INDEX idx_batch_chunk (batch_id, chunk_id),
  INDEX idx_external_id (batch_id, external_id)
);

CREATE TABLE batch_chunks (
  batch_id VARCHAR(32) NOT NULL REFERENCES batches(batch_id),
  chunk_id INT NOT NULL,
  state VARCHAR(16) NOT NULL,
  merkle_root VARCHAR(66),
  items_count INT NOT NULL DEFAULT 0,
  PRIMARY KEY (batch_id, chunk_id)
);
```

---

## 📚 Next Steps

1. **Review with team** - validate API design
2. **Set up ov-content-manager package structure**
3. **Implement MVP endpoints** (Week 1 checklist)
4. **Integrate with ov-vault-agent billing** (credit deduction)
5. **Test with 10k → 100k → 1M item batches**
6. **Launch beta** with select customers
7. **Iterate based on feedback** → add GraphQL, advanced features

---

**Questions?** Ping @luke or open an issue in `ov-content-manager`.


