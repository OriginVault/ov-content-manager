import dotenv from "dotenv";
dotenv.config();
function toBool(v, fallback) {
    if (typeof v === "string") {
        return v.toLowerCase() === "true";
    }
    return fallback;
}
function toNumber(v, fallback) {
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : fallback;
}
export function loadConfig() {
    return {
        nodeEnv: process.env.NODE_ENV || "development",
        port: toNumber(process.env.PORT, 8080),
        modularPort: toNumber(process.env.PORT_MODULAR, 8180),
        minio: {
            endPoint: process.env.MINIO_ENDPOINT || "seaweed",
            port: toNumber(process.env.MINIO_PORT, 8333),
            accessKey: process.env.MINIO_ROOT_USER || "minioadmin",
            secretKey: process.env.MINIO_ROOT_PASSWORD || "minioadmin",
            useSSL: toBool(process.env.MINIO_USE_SSL, false),
            bucket: process.env.MINIO_BUCKET || "ov-content-manager-uploads",
        },
        logto: {
            // App credentials (needed to identify the app to Logto)
            appId: process.env.LOGTO_APP_ID || 'content-manager-app',
            appSecret: process.env.LOGTO_APP_SECRET || 'content-manager-secret',
            tokenEndpoint: process.env.LOGTO_TOKEN_ENDPOINT || `${process.env.LOGTO_ENDPOINT || process.env.LOGTO_BASE_URL || 'https://auth.originvault.box'}/oidc/token`,
            redirectUri: process.env.LOGTO_REDIRECT_URI || 'http://localhost:8080/auth/callback',
            // Server configuration
            baseUrl: process.env.LOGTO_ENDPOINT || process.env.LOGTO_BASE_URL || 'https://auth.originvault.box',
            issuer: process.env.LOGTO_ISSUER || process.env.LOGTO_ENDPOINT || process.env.LOGTO_BASE_URL || 'https://auth.originvault.box',
            jwksUri: process.env.LOGTO_JWKS_URI || `${process.env.LOGTO_ENDPOINT || process.env.LOGTO_BASE_URL || 'https://auth.originvault.box'}/.well-known/jwks.json`,
            allowedAudiences: (process.env.LOGTO_ALLOWED_AUDIENCES || "ov-content-manager").split(",").filter(Boolean),
            allowedClientIds: (process.env.LOGTO_CLIENT_IDS || process.env.LOGTO_ALLOWED_CLIENT_IDS || "content-manager-client").split(",").filter(Boolean),
            requiredScopes: (process.env.LOGTO_REQUIRED_SCOPES || "read:files,write:files,read:storage,write:storage").split(",").filter(Boolean),
        },
        anonymous: {
            maxUploadsPerIp: toNumber(process.env.ANON_MAX_UPLOADS_PER_IP, 3),
            maxFileSizeMb: toNumber(process.env.ANON_MAX_FILE_SIZE_MB, 10),
            ttlHours: toNumber(process.env.ANON_UPLOAD_TTL_HOURS, 24),
        },
        user: {
            maxFileSizeMb: toNumber(process.env.USER_MAX_FILE_SIZE_MB, 100),
            maxBucketSizeGb: toNumber(process.env.USER_MAX_BUCKET_SIZE_GB, 10),
            presignDefaultExpirySeconds: toNumber(process.env.PRESIGN_DEFAULT_EXPIRY_SECONDS, 900),
        },
        redis: {
            url: process.env.REDIS_URL || "redis://localhost:6379",
        },
        rateLimit: {
            store: process.env.RATE_LIMIT_STORE || "memory",
            redisUrl: process.env.REDIS_URL,
        },
    };
}
