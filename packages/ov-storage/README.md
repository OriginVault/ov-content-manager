# @originvault/ov-storage

OriginVault storage server for signing content using C2PA and storing it in SeaweedFS S3.

## Features

- C2PA content signing and verification
- S3-compatible storage via SeaweedFS
- MinIO integration
- Bucket management
- Anonymous and authenticated uploads
- File manifest management
- DID-based authentication
- Redis rate limiting
- Swagger/OpenAPI documentation

## Installation

```bash
npm install
```

## Configuration

Copy `env-template.txt` to `.env` and configure the following:

```bash
# Server configuration
PORT=8087
NODE_ENV=production

# MinIO/S3 configuration
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_USE_SSL=false

# Redis configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# OIDC configuration
LOGTO_ENDPOINT=https://your-logto-instance.com
LOGTO_APP_ID=your-app-id
LOGTO_APP_SECRET=your-app-secret

# C2PA configuration (optional, for production certs)
SSLCOM_API_URL=https://api.c2patool.io/api/v1
SSLCOM_API_KEY=your-api-key
SSLCOM_CERTIFICATE_PROFILE_ID=profile-id
SSLCOM_CONFORMING_PRODUCT_ID=product-id
```

## Development

```bash
npm run dev      # Start development server with hot reload
npm run build    # Build TypeScript to JavaScript
npm start        # Start production server
npm test         # Run tests
npm test:watch   # Run tests in watch mode
```

## API Documentation

Once the server is running, visit:
- Swagger UI: `http://localhost:8087/api-docs`
- OpenAPI spec: `http://localhost:8087/api-docs.json`

## Docker

Build and run with Docker:

```bash
docker build -t ov-storage .
docker run -p 8087:8087 --env-file .env ov-storage
```

## Endpoints

### Health
- `GET /health` - Health check

### Anonymous Uploads
- `POST /anonymous/upload` - Upload file anonymously
- `GET /anonymous/files/:mnemonicId` - Retrieve anonymous file

### Authenticated Uploads
- `POST /files/upload` - Upload file with authentication
- `GET /files/:userId/:mnemonicId` - Retrieve authenticated file

### Bucket Management
- `POST /buckets/create` - Create bucket
- `GET /buckets/list` - List buckets
- `DELETE /buckets/:name` - Delete bucket

### Manifests
- `GET /manifests/:userId/:mnemonicId` - Get C2PA manifest
- `POST /manifests/verify` - Verify C2PA manifest

## Dependencies

- **@originvault/ov-c2pa**: C2PA signing and verification
- **@originvault/ov-id-sdk**: Identity and DID management
- **express**: Web framework
- **minio**: S3 client
- **ioredis**: Redis client
- **c2pa-node**: C2PA SDK
- **jose**: JWT handling

## License

MIT

