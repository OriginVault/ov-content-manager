OriginVault C2PA Server

Overview

The OriginVault C2PA Server is a MinIO-based content management system that integrates C2PA for content authenticity verification. This project allows:

Secure file storage using MinIO

C2PA signing & verification of content

Presigned URL-based access for security

Features

📂 MinIO for object storage

🔏 C2PA integration for signing/verifying media

🔗 Presigned URLs for secure file uploads/downloads

🚀 Docker-based deployment for easy setup

🔄 Automatic retries & health checks for MinIO connectivity

Installation

Prerequisites

Docker & Docker Compose installed

Node.js 18+ (for local development)

WSL 2 (if running on Windows)

1️⃣ Clone the Repository

git clone https://github.com/OriginVault/originvault-c2pa-server.git
cd originvault-c2pa-server

2️⃣ Set Up Environment Variables

Create a .env file:

MINIO_ROOT_USER=admin
MINIO_ROOT_PASSWORD=secretpassword
MINIO_ENDPOINT=minio
MINIO_PORT=9000

3️⃣ Start the Server

Run the following command:

docker compose up --build

This will start MinIO and the C2PA server.

4️⃣ Verify MinIO is Running

Access the MinIO Web UI at:

http://localhost:9090

Login with the credentials from your .env file.

To verify the API:

curl -f http://localhost:9000/minio/health/live

API Usage

🔹 Upload a File

curl -X PUT "http://localhost:9000/originvault-uploads/example.jpg" \
     -H "Authorization: Bearer <your-token>" \
     --data-binary @"example.jpg"

🔹 Sign a File with C2PA

curl -X POST http://localhost:8080/sign -H "Content-Type: application/json" -d '{"fileName": "example.jpg"}'

🔹 Verify a C2PA Signature

curl -X POST http://localhost:8080/verify -H "Content-Type: application/json" -d '{"fileName": "signed-example.jpg"}'

Troubleshooting

❌ MinIO API is Not Accessible

Check if MinIO is running:

docker ps

Restart MinIO:

docker compose restart minio

Verify MinIO from inside C2PA container:

docker exec -it c2pa-1 sh
curl -f http://minio:9000/minio/health/live

❌ C2PA Cannot Connect to MinIO

Modify config.js to use the correct service name:

const minioClient = new Minio.Client({
  endPoint: process.env.MINIO_ENDPOINT || "minio",
  port: parseInt(process.env.MINIO_PORT, 10) || 9000,
  useSSL: false,
  accessKey: process.env.MINIO_ROOT_USER,
  secretKey: process.env.MINIO_ROOT_PASSWORD,
});

Then restart C2PA:

docker compose restart c2pa

❌ MinIO API Redirects to Console (Port 9001)

Modify docker-compose.yml:

command: server /data --console-address ":9090"

Then restart:

docker compose down && docker compose up --build

Contributing

Fork the repository

Create a new branch (git checkout -b feature-name)

Commit your changes (git commit -m "Added new feature")

Push to GitHub (git push origin feature-name)

Open a pull request

License

MIT License - See LICENSE for details.

🎯 Now you have a fully working MinIO + C2PA server! 🚀