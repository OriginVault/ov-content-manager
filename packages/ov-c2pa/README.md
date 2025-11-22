# @originvault/ov-c2pa

Complete C2PA toolkit for manifest generation, signing, and verification with pluggable certificate providers.

## Features

- **Low-level API**: Direct access to C2PA operations for full control
- **High-level API**: Simple `sign()` and `verify()` functions for common use cases
- Comprehensive file type support (images, video, audio, documents, 3D models, fonts, archives)
- Category-specific XMP metadata enrichment
- Sandbox/dev certificate provisioning via SSL.com API
- Manifest generation with custom assertions
- File signing and manifest reading
- Pluggable certificate providers (sandbox, production, HSM)

## Installation

```bash
npm install @originvault/ov-c2pa
```

## Usage

### High-Level API (Recommended for Most Use Cases)

```typescript
import { sign, SandboxCertProvider } from '@originvault/ov-c2pa';

const provider = new SandboxCertProvider({
  apiUrl: 'https://api.c2patool.io/api/v1',
  apiKey: process.env.SSLCOM_API_KEY!,
  certificateProfileId: '6ba3b70c-38fe-44c3-803f-910c5873d1d6',
  conformingProductId: 'f5ac57ef-428e-4a82-8852-7bde10b33060',
  subjectCN: 'My Organization',
  subjectO: 'My Org',
  subjectC: 'US'
});

// Sign a file from URL
const result = await sign({ 
  fileUrl: 'https://example.com/image.jpg',
  title: 'Demo Asset'
}, provider);

console.log('Manifest:', result.manifest);
console.log('Cert summary:', result.certSummary);
// result.signedAsset contains the signed file buffer

// Sign from base64
const result2 = await sign({
  fileBase64: base64String,
  mime: 'image/png',
  title: 'Screenshot'
}, provider);

// Hash-only signing (no file embed)
const result3 = await sign({
  sha256: 'abc123...',
  title: 'Large Video File',
  embed: false
}, provider);
```

### Low-Level API (Advanced Usage)

```typescript
import { createC2paClient } from '@originvault/ov-c2pa';

const client = createC2paClient();

// Generate manifest
const result = await client.generateManifest(fileBuffer, {
  title: 'My Asset',
  fileName: 'image.jpg',
  fileSize: fileBuffer.byteLength,
  mimeType: 'image/jpeg',
  contentHash: 'sha256-hash',
  snowflake: 'unique-id',
  mnemonicId: 'word-phrase',
  uploadTime: new Date(),
});

// Sign file
const signedAsset = await client.signFile(fileBuffer, 'image/jpeg', result.manifest);
```

### Sandbox Mode with Low-Level API

```typescript
import { createC2paClient } from '@originvault/ov-c2pa';

const client = createC2paClient({
  apiUrl: 'https://api.c2patool.io/api/v1',
  apiKey: 'your-api-key',
  certificateProfileId: '6ba3b70c-38fe-44c3-803f-910c5873d1d6',
  conformingProductId: 'f5ac57ef-428e-4a82-8852-7bde10b33060',
  subjectCN: 'Your Organization',
  subjectO: 'Your Org Name',
  subjectC: 'US'
});

// Client will automatically provision a cert on first signFile call
const signedAsset = await client.signFile(fileBuffer, 'image/jpeg', manifest);
```

## Environment Variables (Optional)

If using sandbox mode via environment configuration:

```bash
# SSL.com Sandbox API (for dev/demo C2PA certs)
SSLCOM_API_URL=https://api.c2patool.io/api/v1
SSLCOM_API_KEY=your-api-key-here
SSLCOM_CERTIFICATE_PROFILE_ID=6ba3b70c-38fe-44c3-803f-910c5873d1d6
SSLCOM_CONFORMING_PRODUCT_ID=f5ac57ef-428e-4a82-8852-7bde10b33060
SSLCOM_SUBJECT_CN="OriginVault C2PA"
SSLCOM_SUBJECT_O="OriginVault"
SSLCOM_SUBJECT_C="US"
```

## Supported File Types

- **Images**: JPEG, PNG, GIF, WebP, TIFF, BMP, HEIC, AVIF, SVG, RAW formats
- **Video**: MP4, MOV, AVI, WebM, MKV, MPEG, FLV
- **Audio**: MP3, WAV, FLAC, AAC, OGG, M4A
- **Documents**: PDF, Office formats (Word, Excel, PowerPoint), text files
- **3D Models**: GLTF, OBJ, STL, FBX
- **Archives**: ZIP, RAR, 7Z, TAR, GZIP
- **Fonts**: WOFF, WOFF2, TTF, OTF

## API

### High-Level API

#### `sign(input: SignInput, provider: CertProvider): Promise<SignResult>`

Sign a file or hash with C2PA.

**Input Types:**

```typescript
type SignInput =
  | { fileUrl: string; actions?: string[]; title?: string }
  | { fileBase64: string; mime: string; actions?: string[]; title?: string }
  | { sha256: string; title?: string; actions?: string[]; embed?: false };
```

**Result:**

```typescript
type SignResult = {
  manifest: any;                 // C2PA JSON manifest
  manifestHash: string;          // hex hash of manifest
  certSummary: { 
    issuerCN: string; 
    root: string;                // "C2PA Staging Root" or "C2PA Root"
    notAfter?: string;
  };
  signedAsset?: Buffer;          // present when file is embedded
};
```

#### `verify(input): Promise<VerifyResult>`

Verify a C2PA-signed file (placeholder for now).

```typescript
type VerifyResult = {
  chain: "staging" | "valid" | "invalid";
  integrity: "ok" | "mismatch";
  manifestHash?: string;
};
```

#### `SandboxCertProvider`

Certificate provider for SSL.com sandbox/development certificates.

```typescript
const provider = new SandboxCertProvider({
  apiUrl: 'https://api.c2patool.io/api/v1',
  apiKey: 'your-api-key',
  certificateProfileId: 'profile-id',
  conformingProductId: 'product-id',
  subjectCN: 'Common Name',
  subjectO: 'Organization',
  subjectC: 'US'
});
```

#### Custom Certificate Providers

Implement the `CertProvider` interface for custom certificate sources:

```typescript
export interface CertProvider {
  getSigner(profile?: string): Promise<{
    certPem: string;
    keyPem: string;
    chainPem?: string[];
  }>;
}
```

### Low-Level API

#### `createC2paClient(config?)`

Creates a C2PA client instance.

**Parameters:**
- `config` (optional): Either a custom signer or a `CertProviderConfig` for sandbox mode

**Returns:** `C2PA` instance

#### `C2PA` Methods

#### `isSupported(mimeType: string): boolean`

Check if a MIME type is supported for C2PA operations.

#### `getSupportedTypes(): string[]`

Get list of all supported MIME types.

#### `getFileTypeInfo(mimeType: string): { format: string; extension: string } | null`

Get format and extension info for a MIME type.

#### `generateManifest(fileBuffer: Buffer, options: C2PAManifestOptions): Promise<C2PAManifestResult>`

Generate a C2PA manifest with category-specific metadata.

#### `signFile(fileBuffer: Buffer, mimeType: string, manifest: any): Promise<Buffer | null>`

Sign a file with a C2PA manifest.

#### `readManifest(fileBuffer: Buffer, mimeType: string): Promise<any>`

Read an existing C2PA manifest from a file.

## Certificate Provisioning

When using sandbox mode with SSL.com:

1. Client generates EC P-256 keypair
2. Creates CSR with subject DN
3. Calls SSL.com `POST /certificate-requests`
4. Receives PEM certificate
5. Uses cert + private key for signing

Certificates are provisioned lazily on first `signFile` call and cached for subsequent operations.

## Development

```bash
npm run build  # Compile TypeScript
npm run clean  # Remove dist/
```

## License

MIT

