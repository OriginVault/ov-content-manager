// Set up test environment variables before any modules are loaded
process.env.SNOWFLAKE_DID = "did:cheqd:test:123";
process.env.NODE_ENV = "test";
process.env.MINIO_ENDPOINT = "test";
process.env.MINIO_PORT = "9000";
process.env.MINIO_ROOT_USER = "test";
process.env.MINIO_ROOT_PASSWORD = "test";
process.env.MINIO_BUCKET = "test-bucket";
export {};
