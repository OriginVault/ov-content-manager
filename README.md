<div style="width: 100%; display: flex; justify-content: center; align-items: center;">
      <img src="https://gray-objective-tiglon-784.mypinata.cloud/ipfs/Qma7EjPPPfomzEKkYcJa2ctEFPUhHaMwiojTR1wTQPg2x8" alt="OriginVault logo" width="300" height="300">
</div>
<br />

# OriginVault Content Manager

## Overview

The OriginVault Content Manager is a content management system built on an S3-compatible store (SeaweedFS S3 gateway), designed to ensure content authenticity through C2PA integration. This project offers:

- **Secure file storage** using SeaweedFS S3 gateway
- **C2PA signing & verification** for content authenticity
- **Presigned URL-based access** for enhanced security

## Features

- 📂 **SeaweedFS S3** for object storage
- 🔏 **C2PA integration** for signing and verifying media
- 🔗 **Presigned URLs** for secure file uploads and downloads
- 🚀 **Docker-based deployment** for easy setup
- 🔄 **Automatic retries & health checks** for S3 connectivity

## Installation

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development)
- WSL 2 (if running on Windows)

### Steps

1. **Clone the Repository**

   ```bash
   git clone https://github.com/OriginVault/originvault-storage-server.git
   cd originvault-storage-server
   ```

2. **Set Up Environment Variables**

   Create a `.env` file with the following content:

   ```plaintext
   MINIO_ROOT_USER=admin
   MINIO_ROOT_PASSWORD=secretpassword
   MINIO_ENDPOINT=seaweed
   MINIO_PORT=8333
   MINIO_USE_SSL=false
   ```

3. **Start the Server**

   Run the following command:

   ```bash
   docker compose up --build
   ```

   This will start the SeaweedFS S3 gateway and the C2PA server.

4. **Verify SeaweedFS S3 is Running**

   Test the S3 gateway port:

   ```bash
   curl -I http://localhost:8333
   ```

## API Usage

- **Upload a File**

  ```bash
  curl -X PUT "http://localhost:9000/originvault-uploads/example.jpg" \
       -H "Authorization: Bearer <your-token>" \
       --data-binary @"example.jpg"
  ```

- **Sign a File with C2PA**

  ```bash
  curl -X POST http://localhost:8080/sign -H "Content-Type: application/json" -d '{"fileName": "example.jpg"}'
  ```

- **Verify a C2PA Signature**

  ```bash
  curl -X POST http://localhost:8080/verify -H "Content-Type: application/json" -d '{"fileName": "signed-example.jpg"}'
  ```

## Troubleshooting

- **SeaweedFS S3 Gateway is Not Accessible**

  Check if the service is running:

  ```bash
  docker ps
  ```

  Restart SeaweedFS S3 gateway:

  ```bash
  docker compose restart seaweed
  ```

  Verify S3 from inside the C2PA container:

  ```bash
  docker exec -it storage-server sh
  curl -I http://seaweed:8333
  ```

- **C2PA Cannot Connect to S3**

  Modify `config.js` to use the correct service name:

  ```javascript
  const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || "seaweed",
    port: parseInt(process.env.MINIO_PORT, 10) || 8333,
    useSSL: (process.env.MINIO_USE_SSL || "false").toLowerCase() === "true",
    accessKey: process.env.MINIO_ROOT_USER,
    secretKey: process.env.MINIO_ROOT_PASSWORD,
  });
  ```

  Then restart C2PA:

  ```bash
  docker compose restart c2pa
  ```
  

## Contributing

1. Fork the repository
2. Create a new branch: `git checkout -b feature-name`
3. Commit your changes: `git commit -m "Added new feature"`
4. Push to GitHub: `git push origin feature-name`
5. Open a pull request

## License

MIT License - See [LICENSE](LICENSE) for details.

🎯 Now you have a fully working MinIO + C2PA server! 🚀