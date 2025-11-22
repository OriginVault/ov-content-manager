# C2PA Package Migration Guide

This guide covers the extraction of C2PA functionality into reusable packages and how to use them.

## What Changed

C2PA signing, manifest generation, and certificate provisioning have been extracted into two new packages:

1. **`@originvault/ov-c2pa`** - Low-level C2PA utilities
   - Manifest generation with category-specific metadata
   - File signing and verification
   - Certificate provisioning (sandbox mode via SSL.com)
   - Comprehensive file type support

2. **`@originvault/c2pa-signer`** - High-level signing API
   - Simple `sign()` and `verify()` interface
   - Pluggable certificate providers
   - Support for URLs, base64, and hash-only signing

## Package Structure

```
ov-content-manager/
├── packages/
│   ├── ov-c2pa/           # Low-level C2PA utilities
│   │   ├── src/
│   │   │   ├── index.ts          # Main C2PA client
│   │   │   └── sslSigner.ts      # Sandbox cert provider
│   │   ├── package.json
│   │   └── README.md
│   │
│   └── c2pa-signer/       # High-level signing API
│       ├── src/
│       │   └── index.ts           # sign() and verify() API
│       ├── package.json
│       └── README.md
│
└── storage-server/        # Content manager (uses packages)
    └── src/
        └── app/
            └── services/
                └── c2paService.ts # Thin adapter
```

## Migration Steps

### 1. Build the New Packages

```bash
# From ov-content-manager root
cd packages/ov-c2pa
npm install
npm run build

cd ../c2pa-signer
npm install
npm run build

cd ../../storage-server
npm install  # Will link to local packages
npm run build
```

### 2. Environment Variables (No Changes Required)

The same SSL.com environment variables work as before:

```bash
# Required for sandbox certificate provisioning
SSLCOM_API_URL=https://api.c2patool.io/api/v1
SSLCOM_API_KEY=your-api-key-here

# Optional (defaults provided)
SSLCOM_CERTIFICATE_PROFILE_ID=6ba3b70c-38fe-44c3-803f-910c5873d1d6
SSLCOM_CONFORMING_PRODUCT_ID=f5ac57ef-428e-4a82-8852-7bde10b33060
SSLCOM_SUBJECT_CN="OriginVault C2PA"
SSLCOM_SUBJECT_O="OriginVault"
SSLCOM_SUBJECT_C="US"
```

### 3. Using in Storage Server (Already Migrated)

The `storage-server` has been updated to use `@originvault/ov-c2pa`:

```typescript
// storage-server/src/app/services/c2paService.ts
import { createC2paClient, C2PAManifestOptions, C2PAManifestResult } from "@originvault/ov-c2pa";

export class C2PAService {
  private client = createC2paClient({
    apiUrl: process.env.SSLCOM_API_URL || 'https://api.c2patool.io/api/v1',
    apiKey: process.env.SSLCOM_API_KEY || '',
    // ... other config
  });

  async generateManifest(fileBuffer: Buffer, options: C2PAManifestOptions) {
    return await this.client.generateManifest(fileBuffer, options);
  }

  async signFile(fileBuffer: Buffer, mimeType: string, manifest: any) {
    return await this.client.signFile(fileBuffer, mimeType, manifest);
  }
}
```

### 4. Using the High-Level API (Optional)

For new services or external integrations, use `@originvault/c2pa-signer`:

```typescript
import { sign, SandboxCertProvider } from '@originvault/c2pa-signer';

// Initialize provider once
const provider = new SandboxCertProvider({
  apiUrl: process.env.SSLCOM_API_URL!,
  apiKey: process.env.SSLCOM_API_KEY!,
  certificateProfileId: process.env.SSLCOM_CERTIFICATE_PROFILE_ID!,
  conformingProductId: process.env.SSLCOM_CONFORMING_PRODUCT_ID!,
  subjectCN: process.env.SSLCOM_SUBJECT_CN || 'OriginVault C2PA',
  subjectO: process.env.SSLCOM_SUBJECT_O || 'OriginVault',
  subjectC: process.env.SSLCOM_SUBJECT_C || 'US'
});

// Sign files
const result = await sign({ 
  fileUrl: 'https://example.com/image.jpg',
  title: 'My Asset'
}, provider);

// result.manifest, result.signedAsset, result.certSummary
```

## API Comparison

### Before (Monolithic)

```typescript
// storage-server had all C2PA logic inline
import { createC2pa, createTestSigner, ManifestBuilder } from "c2pa-node";

const c2pa = createC2pa();
const signer = createTestSigner();
const manifest = new ManifestBuilder({ /* ... */ });
const signed = await c2pa.sign({ asset, signer, manifest });
```

### After (Modular)

```typescript
// Low-level API
import { createC2paClient } from '@originvault/ov-c2pa';

const client = createC2paClient(certConfig);
const { manifest } = await client.generateManifest(buffer, options);
const signed = await client.signFile(buffer, mimeType, manifest);

// Or high-level API
import { sign, SandboxCertProvider } from '@originvault/c2pa-signer';

const provider = new SandboxCertProvider(config);
const result = await sign({ fileUrl }, provider);
```

## Certificate Modes

### Test Mode (Default)

If no config provided, uses `c2pa-node` test signer:

```typescript
const client = createC2paClient(); // Uses test certificates
```

### Sandbox Mode (SSL.com Dev Certs)

Provide `CertProviderConfig`:

```typescript
const client = createC2paClient({
  apiUrl: 'https://api.c2patool.io/api/v1',
  apiKey: 'your-key',
  certificateProfileId: 'profile-id',
  conformingProductId: 'product-id',
  subjectCN: 'Your Org',
  subjectO: 'Your Org Name',
  subjectC: 'US'
});
```

Certificates are provisioned lazily on first `signFile()` call.

### Production Mode (Future)

Custom cert providers can be implemented:

```typescript
class ProductionCertProvider implements CertProvider {
  async getSigner(profile?: string) {
    // Fetch from DigiCert, HSM, etc.
    return { certPem, keyPem, chainPem };
  }
}
```

## Breaking Changes

### None for Storage Server

The `storage-server` continues to work exactly as before. The internal implementation now delegates to `@originvault/ov-c2pa`, but the API surface is unchanged.

### For Direct c2pa-node Users

If you were using `c2pa-node` directly (e.g., in `routes/manifests.ts`), those imports have been replaced with `@originvault/ov-c2pa`.

**Before:**
```typescript
import { createC2pa, createTestSigner, ManifestBuilder } from "c2pa-node";
```

**After:**
```typescript
import { createC2paClient } from "@originvault/ov-c2pa";
```

## Benefits

1. **Reusability**: C2PA logic can be used in other services (BFF, batch signer, CLI)
2. **Testability**: Easier to mock certificate providers in tests
3. **Productization**: Clean API for selling "C2PA Signing as a Service"
4. **Maintainability**: C2PA concerns separated from storage/auth/DID logic
5. **Flexibility**: Easy to swap certificate backends (sandbox → production)

## Future Enhancements

- Full verification implementation
- Production certificate providers (DigiCert, GlobalSign)
- HSM/TEE integration for key storage
- Timestamping service integration
- Batch signing API
- CLI tool for demos (`ov-c2pa sign --url <...>`)

## Troubleshooting

### Build Errors

If you see module resolution errors:

```bash
cd ov-content-manager/packages/ov-c2pa
npm install
npm run build

cd ../c2pa-signer
npm install
npm run build

cd ../../storage-server
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Missing Certificates

If signing fails with "no signer available":

1. Verify `SSLCOM_API_KEY` is set
2. Check API endpoint is reachable
3. Confirm certificate profile IDs are valid
4. Check logs for detailed error messages

### Type Errors

Make sure packages are built before storage-server:

```bash
# Build order matters
npm run build --workspace=@originvault/ov-c2pa
npm run build --workspace=@originvault/c2pa-signer
npm run build --workspace=storage-server
```

## Support

For questions or issues:
- Low-level C2PA: See `packages/ov-c2pa/README.md`
- High-level API: See `packages/c2pa-signer/README.md`
- Storage server integration: See `storage-server/README.md`

