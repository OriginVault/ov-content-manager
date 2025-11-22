import { loadConfig } from "./app/config.js";
import { ensureBucket } from "./app/minio.js";
import logger from "./app/logger.js";
import { createApp, shutdownApp } from "./app/createApp.js";
import { cleanupService } from "./app/services/cleanup.js";
import { storageService } from "./app/services/storageService.js";
import { parentAgent, parentStore } from "@originvault/ov-id-sdk";
const config = loadConfig();
const port = config.modularPort;
// DID Agent initialization variables
let signingDid = null;
let signingAgent = parentAgent;
let provider = null;
let keys = null;
let agentInitialized = false;
async function initializeAgent() {
    logger.info('Starting DID agent initialization...');
    try {
        const initializedAgent = await parentStore.initialize({
            payerSeed: process.env.COSMOS_PAYER_SEED,
            didRecoveryPhrase: process.env.PARENT_DID_RECOVERY_PHRASE
        });
        logger.info('DID agent initialized successfully.');
        const { agent, did, cheqdMainnetProvider, privateKeyStore } = initializedAgent;
        signingDid = did;
        signingAgent = agent;
        provider = cheqdMainnetProvider;
        keys = privateKeyStore;
        agentInitialized = true;
        // DID agent is now handled by parentStore in the DidManagerService
        logger.info('DID agent components initialized:', {
            signingDid,
            hasAgent: !!signingAgent,
            hasProvider: !!provider,
            hasKeys: !!keys
        });
    }
    catch (error) {
        logger.error('Error initializing DID agent:', error);
        throw error;
    }
}
async function startServer() {
    try {
        const app = await createApp();
        const server = app.listen(port, async () => {
            try {
                await ensureBucket();
                // Initialize DID agent first
                await initializeAgent();
                // Start cleanup service for anonymous uploads
                await cleanupService.start();
                logger.info("Anonymous upload cleanup service started");
                // Now that the agent is initialized, ensure anonymous storage DID exists
                try {
                    const anonymousStorageDid = await storageService.ensureAnonymousStorageDid();
                    logger.info(`Anonymous storage DID ensured: ${anonymousStorageDid}`);
                    // Update environment variable for runtime use
                    process.env.ANON_BUCKET_DID = anonymousStorageDid;
                }
                catch (error) {
                    logger.error("Failed to ensure anonymous storage DID:", error);
                    logger.warn("Anonymous uploads may not work without proper DID configuration");
                }
            }
            catch (e) {
                logger.error("Failed ensuring bucket: " + e.message);
            }
            logger.info(`C2PA Modular Server running on port ${port}`);
        });
        // Graceful shutdown
        process.on('SIGTERM', async () => {
            logger.info('SIGTERM received, shutting down gracefully');
            server.close(async () => {
                await shutdownApp();
                process.exit(0);
            });
        });
        process.on('SIGINT', async () => {
            logger.info('SIGINT received, shutting down gracefully');
            server.close(async () => {
                await shutdownApp();
                process.exit(0);
            });
        });
    }
    catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
