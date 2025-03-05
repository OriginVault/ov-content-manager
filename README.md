<div style="width: 100%; display: flex; justify-content: center; align-items: center;">
      <img src="https://gray-objective-tiglon-784.mypinata.cloud/ipfs/Qma7EjPPPfomzEKkYcJa2ctEFPUhHaMwiojTR1wTQPg2x8" alt="OriginVault logo" width="300" height="300">
</div>
<br />

# OriginVault Content Manager

## Overview

The OriginVault Content Manager is a content management system built on MinIO, designed to ensure content authenticity through C2PA integration. This project offers:

- **Secure file storage** using MinIO
- **C2PA signing & verification** for content authenticity
- **Presigned URL-based access** for enhanced security

## Features

- 📂 **MinIO** for object storage
- 🔏 **C2PA integration** for signing and verifying media
- 🔗 **Presigned URLs** for secure file uploads and downloads
- 🚀 **Docker-based deployment** for easy setup
- 🔄 **Automatic retries & health checks** for MinIO connectivity

## Installation

### Prerequisites

- Docker & Docker Compose
- Node.js 18+ (for local development)
- WSL 2 (if running on Windows)

### Steps

1. **Clone the Repository**

   ```bash
   git clone https://github.com/OriginVault/originvault-c2pa-server.git
   cd originvault-c2pa-server
   ```

2. **Set Up Environment Variables**

   Create a `.env` file with the following content:

   ```plaintext
   MINIO_ROOT_USER=admin
   MINIO_ROOT_PASSWORD=secretpassword
   MINIO_ENDPOINT=minio
   MINIO_PORT=9000
   ```

3. **Start the Server**

   Run the following command:

   ```bash
   docker compose up --build
   ```

   This will start MinIO and the C2PA server.

4. **Verify MinIO is Running**

   Access the MinIO Web UI at: [http://localhost:9090](http://localhost:9090)

   Login with the credentials from your `.env` file.

   To verify the API:

   ```bash
   curl -f http://localhost:9000/minio/health/live
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

- **MinIO API is Not Accessible**

  Check if MinIO is running:

  ```bash
  docker ps
  ```

  Restart MinIO:

  ```bash
  docker compose restart minio
  ```

  Verify MinIO from inside the C2PA container:

  ```bash
  docker exec -it c2pa-1 sh
  curl -f http://minio:9000/minio/health/live
  ```

- **C2PA Cannot Connect to MinIO**

  Modify `config.js` to use the correct service name:

  ```javascript
  const minioClient = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT || "minio",
    port: parseInt(process.env.MINIO_PORT, 10) || 9000,
    useSSL: false,
    accessKey: process.env.MINIO_ROOT_USER,
    secretKey: process.env.MINIO_ROOT_PASSWORD,
  });
  ```

  Then restart C2PA:

  ```bash
  docker compose restart c2pa
  ```

- **MinIO API Redirects to Console (Port 9001)**

  Modify `docker-compose.yml`:

  ```yaml
  command: server /data --console-address ":9090"
  ```

  Then restart:

  ```bash
  docker compose down && docker compose up --build
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